import { useState, useEffect, useRef } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

function fetchWithTimeout(url, options, timeout = 30000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout - backend may be slow or unreachable')), timeout)
    )
  ])
}

export default function App() {
  const [question, setQuestion] = useState('')
  const [useLLM, setUseLLM] = useState(true) // Always enabled - cannot be disabled
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [sources, setSources] = useState([])
  const [chunks, setChunks] = useState([])
  const [error, setError] = useState(null)
  const [ticketId, setTicketId] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [rating, setRating] = useState(null)
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [tickets, setTickets] = useState([])
  const [showTickets, setShowTickets] = useState(false)
  const [backendStatus, setBackendStatus] = useState('checking')
  const [selectedSource, setSelectedSource] = useState(null)
  const [sourcesExpanded, setSourcesExpanded] = useState(false)
  const [conversationHistory, setConversationHistory] = useState([])
  const [mediaImages, setMediaImages] = useState([])
  const [mediaVideos, setMediaVideos] = useState([])
  const [sourceImages, setSourceImages] = useState({}) // Images per source for inline display
  const [imageMappings, setImageMappings] = useState([]) // Images with context for smart matching
  const [selectedImage, setSelectedImage] = useState(null)
  const [showCreateTicket, setShowCreateTicket] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingAnswer, setStreamingAnswer] = useState('')
  const [suggestedQuestions, setSuggestedQuestions] = useState([])
  const [savedConversations, setSavedConversations] = useState([])
  const [currentConversationId, setCurrentConversationId] = useState(null)
  const [showHistorySidebar, setShowHistorySidebar] = useState(false)
  const [ticketReason, setTicketReason] = useState('')
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketCategory, setTicketCategory] = useState('')
  const [ticketDescription, setTicketDescription] = useState('')
  const [additionalNotes, setAdditionalNotes] = useState('')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [logoError, setLogoError] = useState(false)
  const [userId, setUserId] = useState(null)
  const [siteId, setSiteId] = useState(null)
  const [userTags, setUserTags] = useState([])
  
  // Rich Feedback State
  const [feedbackReason, setFeedbackReason] = useState('')
  const [showFeedbackForm, setShowFeedbackForm] = useState(false)
  
  const chatEndRef = useRef(null)

  // Expose scrollToSource and openInlineImage to window for inline interactions
  useEffect(() => {
    window.scrollToSource = (index) => {
      const idx = parseInt(index) - 1
      setSelectedSource(idx)
      const panel = document.getElementById('sources-panel')
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth' })
        setSourcesExpanded(true)
      }
    }
    
    // Function to open inline images in lightbox
    window.openInlineImage = (imageUrl) => {
      // Handle relative URLs - they should start with /media/
      const fullUrl = imageUrl.startsWith('http') ? imageUrl : imageUrl
      setSelectedImage(fullUrl)
    }
    
    return () => {
      delete window.scrollToSource
      delete window.openInlineImage
    }
  }, [])

  // Load conversations from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('conversations')
    if (saved) {
      try {
        setSavedConversations(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to load conversations:', e)
      }
    }
  }, [])

  // Save conversations to localStorage whenever they change
  useEffect(() => {
    if (savedConversations.length > 0) {
      localStorage.setItem('conversations', JSON.stringify(savedConversations))
    }
  }, [savedConversations])

  // Auto-save conversation when it's updated (has both user and assistant messages)
  useEffect(() => {
    if (conversationHistory.length >= 2) {
      const hasUser = conversationHistory.some(m => m.role === 'user')
      const hasAssistant = conversationHistory.some(m => m.role === 'assistant')
      
      if (hasUser && hasAssistant && !loading) {
        // Delay slightly to ensure state is fully updated
        const timer = setTimeout(() => {
          const conversationId = currentConversationId || Date.now().toString()
          const firstUserMsg = conversationHistory.find(m => m.role === 'user')
          const title = firstUserMsg ? firstUserMsg.content.substring(0, 50) + '...' : 'New conversation'
          
          const conversation = {
            id: conversationId,
            title,
            messages: conversationHistory,
            timestamp: Date.now(),
            question: firstUserMsg?.content,
            answer: conversationHistory.find(m => m.role === 'assistant')?.content,
            // Save additional context for full conversation restoration
            sources: sources,
            chunks: chunks,
            media: {
              images: mediaImages,
              videos: mediaVideos,
            },
            ticketId: ticketId,
          }
          
          setSavedConversations(prev => {
            const filtered = prev.filter(c => c.id !== conversationId)
            return [conversation, ...filtered].slice(0, 50)
          })
          
          if (!currentConversationId) {
            setCurrentConversationId(conversationId)
          }
        }, 300)
        
        return () => clearTimeout(timer)
      }
    }
  }, [conversationHistory, loading, currentConversationId, sources, chunks, mediaImages, mediaVideos, ticketId])

  // Check backend health on mount
  useEffect(() => {
    fetchWithTimeout(`${API_BASE}/health`, {}, 5000)
      .then(res => res.ok ? setBackendStatus('online') : setBackendStatus('error'))
      .catch(() => setBackendStatus('offline'))
  }, [])

  // Load tickets
  useEffect(() => {
    if (showTickets) {
      loadTickets()
    }
  }, [showTickets])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [conversationHistory, loading])

  // Capture user context from parent window or localStorage
  useEffect(() => {
    const getContextFromParent = () => {
      // Method 1: Try to get from parent window (if embedded in iframe)
      try {
        if (window.parent && window.parent !== window) {
          // Try multiple ways the main website might expose user data
          const parentData = 
            window.parent.userContext || 
            window.parent.getUserContext?.() ||
            window.parent.window?.userContext ||
            window.parent.document?.userContext
          
          if (parentData) {
            const uid = parentData.userId || parentData.user_id || parentData.id
            const sid = parentData.siteId || parentData.site_id
            const tgs = parentData.tags || []
            
            if (uid) {
              setUserId(uid)
              localStorage.setItem('userId', uid)
            }
            if (sid) {
              setSiteId(sid)
              localStorage.setItem('siteId', sid)
            }
            if (tgs && Array.isArray(tgs) && tgs.length) {
              setUserTags(tgs)
              localStorage.setItem('tags', JSON.stringify(tgs))
            }
            return
          }
        }
      } catch (e) {
        console.log("Could not access parent window:", e)
      }
      
      // Method 2: Try postMessage from parent (if main website uses postMessage)
      const handleMessage = (event) => {
        // In production, verify event.origin for security
        if (event.data && (event.data.type === 'userContext' || event.data.userId || event.data.user_id)) {
          const data = event.data.payload || event.data
          if (data.userId || data.user_id) {
            const uid = data.userId || data.user_id
            setUserId(uid)
            localStorage.setItem('userId', uid)
          }
          if (data.siteId || data.site_id) {
            const sid = data.siteId || data.site_id
            setSiteId(sid)
            localStorage.setItem('siteId', sid)
          }
          if (data.tags) {
            setUserTags(data.tags)
            localStorage.setItem('tags', JSON.stringify(data.tags))
          }
        }
      }
      window.addEventListener('message', handleMessage)
      
      // Request user context from parent
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'requestUserContext' }, '*')
        }
      } catch (e) {
        console.log("Could not send message to parent:", e)
      }
      
      // Method 3: Try localStorage/sessionStorage (if main website stores it there)
      try {
        const storedUserId = localStorage.getItem('userId') || 
                            sessionStorage.getItem('userId') ||
                            localStorage.getItem('user_id') ||
                            sessionStorage.getItem('user_id')
        const storedSiteId = localStorage.getItem('siteId') || 
                            sessionStorage.getItem('siteId') ||
                            localStorage.getItem('site_id') ||
                            sessionStorage.getItem('site_id')
        const storedTagsStr = localStorage.getItem('tags') || sessionStorage.getItem('tags') || '[]'
        const storedTags = JSON.parse(storedTagsStr)
        
        if (storedUserId) setUserId(storedUserId)
        if (storedSiteId) setSiteId(storedSiteId)
        if (storedTags && Array.isArray(storedTags) && storedTags.length) setUserTags(storedTags)
      } catch (e) {
        console.log("Could not read from storage:", e)
      }
      
      // Method 4: Try URL parameters (if main website passes it via query string)
      try {
        const urlParams = new URLSearchParams(window.location.search)
        const urlUserId = urlParams.get('userId') || urlParams.get('user_id')
        const urlSiteId = urlParams.get('siteId') || urlParams.get('site_id')
        
        if (urlUserId) {
          setUserId(urlUserId)
          localStorage.setItem('userId', urlUserId)
        }
        if (urlSiteId) {
          setSiteId(urlSiteId)
          localStorage.setItem('siteId', urlSiteId)
        }
      } catch (e) {
        console.log("Could not read URL parameters:", e)
      }
    }
    
    getContextFromParent()
    
    // Poll for user context changes every 2 seconds (in case main website updates it)
    const interval = setInterval(() => {
      const storedUserId = localStorage.getItem('userId')
      if (storedUserId && storedUserId !== userId) {
        setUserId(storedUserId)
      }
    }, 2000)
    
    return () => clearInterval(interval)
  }, [userId])

  async function loadTickets() {
    try {
      const res = await fetch(`${API_BASE}/tickets?limit=20`)
      if (res.ok) {
        const data = await res.json()
        setTickets(data.tickets || [])
      }
    } catch (e) {
      console.error('Failed to load tickets:', e)
    }
  }

  // Save current conversation to history
  function saveConversation() {
    if (conversationHistory.length === 0) return
    
    const conversationId = currentConversationId || Date.now().toString()
    const firstUserMsg = conversationHistory.find(m => m.role === 'user')
    const title = firstUserMsg ? firstUserMsg.content.substring(0, 50) + '...' : 'New conversation'
    
    const conversation = {
      id: conversationId,
      title,
      messages: conversationHistory,
      timestamp: Date.now(),
      question: firstUserMsg?.content,
      answer: conversationHistory.find(m => m.role === 'assistant')?.content,
    }
    
    setSavedConversations(prev => {
      const filtered = prev.filter(c => c.id !== conversationId)
      return [conversation, ...filtered].slice(0, 50) // Keep last 50
    })
    
    setCurrentConversationId(conversationId)
  }

  // Load a conversation from history
  function loadConversation(conv) {
    // Clear current state first
    setAnswer(null)
    setSources([])
    setChunks([])
    setMediaImages([])
    setMediaVideos([])
    setSuggestedQuestions([])
    setError(null)
    
    // Load conversation data
    setConversationHistory(conv.messages || [])
    setCurrentConversationId(conv.id)
    
    // Restore conversation context if available
    if (conv.sources) setSources(conv.sources)
    if (conv.chunks) setChunks(conv.chunks)
    if (conv.media) {
      setMediaImages(conv.media.images || [])
      setMediaVideos(conv.media.videos || [])
    }
    if (conv.ticketId) setTicketId(conv.ticketId)
    
    // Set the final answer
    if (conv.answer) {
      setAnswer(conv.answer)
    }
    
    // Close sidebar
    setShowHistorySidebar(false)
    
    // Scroll to top to show the conversation
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Start new conversation
  function newConversation() {
    setConversationHistory([])
    setCurrentConversationId(null)
    setAnswer(null)
    setSources([])
    setChunks([])
    setMediaImages([])
    setMediaVideos([])
    setSuggestedQuestions([])
    setQuestion('')
  }

  // Delete conversation
  function deleteConversation(id) {
    setSavedConversations(prev => prev.filter(c => c.id !== id))
    if (currentConversationId === id) {
      newConversation()
    }
  }

  async function onAsk(e) {
    e.preventDefault()
    const currentQuestion = question.trim()
    if (!currentQuestion) return

    setLoading(true)
    setIsStreaming(true)
    setError(null)
    setAnswer(null)
    setStreamingAnswer('')
    setSources([])
    setChunks([])
    setTicketId(null)
    setFeedback('')
    setRating(null)
    setFeedbackSubmitted(false)
    setSelectedSource(null)
    setShowCreateTicket(false)
    setMediaImages([])
    setMediaVideos([])
    setSourceImages({})
    setImageMappings([])
    setSuggestedQuestions([])

    // Add user question to conversation history
    const userMessage = { role: 'user', content: currentQuestion }
    const updatedHistory = [...conversationHistory, userMessage]
    setConversationHistory(updatedHistory)

    try {
      const headers = {
        'Content-Type': 'application/json',
      }
      
      // Add user context headers
      if (userId) headers['X-User-ID'] = userId
      if (siteId) headers['X-Site-ID'] = siteId
      if (userTags.length) headers['X-Tags'] = userTags.join(',')
      
      const response = await fetch(`${API_BASE}/ask/stream`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          question: currentQuestion,
          use_llm: true,
          top_k: 5,
          conversation_history: conversationHistory,
          user_id: userId,
          site_id: siteId,
          tags: userTags,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullAnswer = ''

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
                              if (data.type === 'metadata') {
                                setTicketId(data.ticket_id)
                                setSources(data.sources || [])
                                setChunks(data.chunks || [])
                                if (data.media) {
                                  setMediaImages(data.media.images || [])
                                  setMediaVideos(data.media.videos || [])
                                }
                                // Store images per source for inline display
                                if (data.source_images) {
                                  setSourceImages(data.source_images)
                                }
                                // Store image mappings for smart matching
                                if (data.image_mappings) {
                                  setImageMappings(data.image_mappings)
                                }
                              } else if (data.type === 'token') {
                fullAnswer += data.content
                setStreamingAnswer(fullAnswer)
              } else if (data.type === 'answer') {
                fullAnswer = data.content
                setStreamingAnswer(fullAnswer)
              } else if (data.type === 'suggestions') {
                setSuggestedQuestions(data.questions || [])
              } else if (data.type === 'done') {
                setAnswer(fullAnswer)
                setStreamingAnswer('')
                
                // Add assistant response to conversation history
                if (fullAnswer) {
                  const newHistory = [...updatedHistory, { role: 'assistant', content: fullAnswer }]
                  setConversationHistory(newHistory)
                }
              } else if (data.type === 'error') {
                throw new Error(data.message)
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError)
            }
          }
        }
      }

      // Clear question input
      setQuestion('')
    } catch (err) {
      const msg = err.message || String(err)
      setError(msg.includes('timeout') || msg.includes('Failed to fetch') 
        ? `Backend unreachable at ${API_BASE}. Is it running?` 
        : msg)
      console.error('Ask error:', err)
    } finally {
      setLoading(false)
      setIsStreaming(false)
    }
  }

  // Handle clicking a suggested question
  function handleSuggestedQuestion(q) {
    setQuestion(q)
    // Auto-submit
    setTimeout(() => {
      const form = document.querySelector('form')
      if (form) form.requestSubmit()
    }, 100)
  }

  async function submitFeedback() {
    if (!ticketId || !feedback.trim()) return
    try {
      const res = await fetch(`${API_BASE}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticketId,
          feedback: feedback.trim(),
          rating: rating,
        }),
      })
      if (res.ok) {
        setFeedbackSubmitted(true)
        if (showTickets) loadTickets()
      } else {
        const txt = await res.text()
        alert(`Failed to submit feedback: ${txt}`)
      }
    } catch (e) {
      alert(`Error: ${e.message}`)
    }
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files)
    const validFiles = files.filter(file => {
      const ext = '.' + file.name.split('.').pop().toLowerCase()
      return ['.pdf', '.png', '.jpg', '.jpeg'].includes(ext)
    })
    
    if (validFiles.length !== files.length) {
      alert('Some files were skipped. Only PDF, PNG, JPG, and JPEG files are allowed.')
    }
    
    setSelectedFiles(prev => [...prev, ...validFiles])
  }

  function removeFile(index) {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  async function uploadFiles(ticketId) {
    if (selectedFiles.length === 0) return []
    
    const formData = new FormData()
    selectedFiles.forEach(file => {
      formData.append('files', file)
    })
    formData.append('user_id', userId || 'anonymous')
    formData.append('ticket_id', ticketId)
    
    const res = await fetch(`${API_BASE}/upload-attachment`, {
      method: 'POST',
      body: formData,
    })
    
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(txt || 'File upload failed')
    }
    
    const data = await res.json()
    return data.file_paths || []
  }

  async function createSupportTicket() {
    // Validate required fields
    if (!ticketTitle.trim()) {
      alert('Please provide a title for the ticket')
      return
    }
    if (!ticketCategory) {
      alert('Please select a category')
      return
    }
    if (!ticketDescription.trim()) {
      alert('Please provide a description')
      return
    }
    
    setUploadingFiles(true)
    
    try {
      // Generate ticket ID first (UUID format to match backend)
      const generateUUID = () => {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0
          const v = c === 'x' ? r : (r & 0x3 | 0x8)
          return v.toString(16)
        })
      }
      const ticketId = generateUUID()
      
      // Upload files first if any
      let attachmentPaths = []
      if (selectedFiles.length > 0) {
        try {
          attachmentPaths = await uploadFiles(ticketId)
        } catch (uploadError) {
          alert(`File upload failed: ${uploadError.message}`)
          setUploadingFiles(false)
          return
        }
      }
      
      // Now create the ticket with the ticket ID and attachment paths
      const headers = {
        'Content-Type': 'application/json',
      }
      
      // Add user context headers
      if (userId) headers['X-User-ID'] = userId
      if (siteId) headers['X-Site-ID'] = siteId
      if (userTags.length) headers['X-Tags'] = userTags.join(',')
      
      // Extract the user's original question from conversation history (first user message)
      // NOT the last message which would be the assistant's answer
      const userQuestion = conversationHistory.length > 0 
        ? (conversationHistory.find(msg => msg.role === 'user')?.content || question.trim())
        : question.trim()
      
      const res = await fetch(`${API_BASE}/create-ticket`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          question: userQuestion,  // Use the FIRST user message, not the last message
          title: ticketTitle.trim(),
          category: ticketCategory,
          severity: 'Medium', // Read-only, set by company
          description: ticketDescription.trim(),
          reason: ticketReason.trim() || 'User requested support ticket',
          additional_notes: additionalNotes.trim() || '',  // NEW: Additional notes field
          conversation_history: conversationHistory,
          user_id: userId,
          site_id: siteId,
          tags: userTags,
          attachments: attachmentPaths,
          ticket_id: ticketId, // Pass the ticket ID so files are in the right folder
        }),
      })
      
      if (res.ok) {
        const data = await res.json()
        const ticketNum = data.ticket_number || data.ticket_id
        alert(`Support ticket created successfully! Ticket Number: ${ticketNum}`)
        setShowCreateTicket(false)
        setTicketTitle('')
        setTicketCategory('')
        setTicketDescription('')
        setTicketReason('')
        setAdditionalNotes('')
        setSelectedFiles([])
        if (showTickets) loadTickets()
      } else {
        const txt = await res.text()
        alert(`Failed to create ticket: ${txt}`)
      }
    } catch (e) {
      alert(`Error: ${e.message}`)
    } finally {
      setUploadingFiles(false)
    }
  }

  
  async function submitRichFeedback(ratingValue, reason = '', comment = '') {
    if (!ticketId) return
    
    const fullFeedback = reason ? `[${reason}] ${comment}` : comment
    
    try {
      const res = await fetch(`${API_BASE}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticketId,
          feedback: fullFeedback,
          rating: ratingValue,
        }),
      })
      
      if (res.ok) {
        setFeedbackSubmitted(true)
        setFeedbackReason('')
        setShowFeedbackForm(false)
        if (showTickets) loadTickets()
      }
    } catch (e) {
      console.error("Feedback failed", e)
    }
  }

  function clearConversation() {
    setConversationHistory([])
    setAnswer(null)
    setSources([])
    setChunks([])
    setTicketId(null)
    setShowCreateTicket(false)
    setTicketTitle('')
    setTicketCategory('')
    setTicketDescription('')
    setTicketReason('')
    setSelectedFiles([])
  }

  return (
    <div className="wrap">
      {/* Conversation History Sidebar */}
      {showHistorySidebar && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 9998,
          }}
          onClick={() => setShowHistorySidebar(false)}
        />
      )}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: showHistorySidebar ? 0 : '-320px',
          width: '320px',
          height: '100vh',
          background: 'white',
          boxShadow: '2px 0 12px rgba(0,0,0,0.1)',
          transition: 'left 0.3s ease',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Sidebar Header */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            💬 Chat History
          </h3>
          <button
            onClick={() => setShowHistorySidebar(false)}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: 'var(--muted)',
              padding: '4px 8px',
            }}
          >
            ×
          </button>
        </div>

        {/* New Conversation Button */}
        <div style={{ padding: '12px' }}>
          <button
            onClick={newConversation}
            style={{
              width: '100%',
              padding: '10px',
              background: 'linear-gradient(180deg, var(--brand), var(--brand-2))',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            + New Conversation
          </button>
        </div>

        {/* Conversations List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 12px 12px',
        }}>
          {savedConversations.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 13,
              padding: '32px 16px',
            }}>
              No conversations yet
            </div>
          ) : (
            savedConversations.map(conv => (
              <div
                key={conv.id}
                style={{
                  padding: '12px',
                  marginBottom: '8px',
                  background: currentConversationId === conv.id ? 'var(--panel)' : 'white',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  position: 'relative',
                }}
                onClick={() => loadConversation(conv)}
              >
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  paddingRight: '24px',
                }}>
                  {conv.question || 'Untitled'}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                }}>
                  {new Date(conv.timestamp).toLocaleDateString()} {new Date(conv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteConversation(conv.id)
                  }}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                    fontSize: 16,
                    padding: 0,
                  }}
                  title="Delete conversation"
                >
                  🗑️
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="header">
        {logoError ? (
          <div className="logo-fallback" />
        ) : (
          <img 
            src="/logo.png" 
            alt="DrCloudEHR Logo" 
            className="logo"
            onError={() => setLogoError(true)}
          />
        )}
        <div style={{ flex: 1 }}>
          <div className="title">DrCloudEHR Support</div>
          <div className="subtitle">
            Ask questions over our knowledge base
            {backendStatus === 'online' && <span style={{ color: 'var(--success)', marginLeft: 8 }}>● Backend online</span>}
            {backendStatus === 'offline' && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>● Backend offline</span>}
            {backendStatus === 'checking' && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>● Checking...</span>}
          </div>
        </div>
        <button
          onClick={() => setShowHistorySidebar(!showHistorySidebar)}
          style={{
            background: 'white',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '8px 12px',
            cursor: 'pointer',
            fontSize: 20,
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
          title="Conversation history"
        >
          💬
          {savedConversations.length > 0 && (
            <span style={{
              background: 'var(--brand)',
              color: 'white',
              borderRadius: '12px',
              padding: '2px 6px',
              fontSize: 11,
              fontWeight: 600,
            }}>
              {savedConversations.length}
            </span>
          )}
        </button>
      </div>

      {/* Question Input Section */}
      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={onAsk} className="row">
          <textarea
            className="textarea"
            rows={4}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask any question"
          />
          <div className="actions">
            <div className="left">
              {loading && <span className="muted">Thinking…</span>}
              {conversationHistory.length > 0 && (
                <button
                  type="button"
                  onClick={clearConversation}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontSize: 12,
                    padding: '4px 8px',
                    borderRadius: 6,
                    marginLeft: 8
                  }}
                >
                  Clear Chat
                </button>
              )}
            </div>
            <button className="btn" type="submit" disabled={loading || !question.trim()}>
              {loading ? 'Asking…' : 'Ask'}
            </button>
          </div>
        </form>

        {error && (
          <div style={{ marginTop: 14 }} className="alert">
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>

      {/* Conversation - Full Width */}
      <div className="card" style={{ marginBottom: 16, position: 'relative', paddingBottom: conversationHistory.length > 0 ? '70px' : '16px' }}>
        <h3 style={{ margin: 0, marginBottom: 12 }}>Conversation</h3>
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 12, 
          padding: '8px 0',
          minHeight: '400px',
          maxHeight: '600px',
          overflowY: 'auto',
          scrollBehavior: 'smooth'
        }}>
          {conversationHistory.length === 0 && !loading && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              height: '200px',
              color: 'var(--muted)',
              textAlign: 'center'
            }}>
              <div>
                <div style={{ fontSize: 16, marginBottom: 8 }}>👋 Welcome to DrCloudEHR Support</div>
                <div>Start a conversation by asking a question above</div>
              </div>
            </div>
          )}
          
          {conversationHistory.map((msg, idx) => {
            const isLastMessage = idx === conversationHistory.length - 1
            
            // Format answer text - clean professional style with inline images
            const formatAnswer = (content) => {
              if (msg.role === 'user') return content
              
              // Extract important keywords from text (nouns, verbs, key terms)
              const extractKeywords = (text) => {
                if (!text) return new Set()
                // Convert to lowercase and split on non-alphanumeric
                const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)
                // Filter out common stop words
                const stopWords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'will', 'can', 'are', 'has', 'have', 'been', 'was', 'were', 'being'])
                return new Set(words.filter(w => !stopWords.has(w)))
              }
              
              // Score how well step text matches image context
              const getMatchScore = (stepText, contextText) => {
                if (!stepText || !contextText) return 0
                const stepWords = extractKeywords(stepText)
                const contextWords = extractKeywords(contextText)
                if (stepWords.size === 0 || contextWords.size === 0) return 0
                
                let matches = 0
                let importantMatches = 0
                
                // Important keywords that strongly indicate a match
                const importantKeywords = ['darts', 'practice', 'patient', 'chart', 'transaction', 'submit', 'service', 'status', 'encounter', 'facility', 'categories', 'mapping', 'interface', 'administrative', 'picklist', 'records', 'manager', 'global', 'enable', 'flag']
                
                for (const word of stepWords) {
                  if (contextWords.has(word)) {
                    matches++
                    if (importantKeywords.includes(word)) {
                      importantMatches += 2  // Double weight for important keywords
                    }
                  }
                }
                
                // Also check if context contains step number that matches
                const stepNumMatch = stepText.match(/^(\d+)\./)
                if (stepNumMatch) {
                  const num = stepNumMatch[1]
                  if (contextText.includes(`${num}.`) || contextText.startsWith(num)) {
                    importantMatches += 1
                  }
                }
                
                return (matches + importantMatches) / Math.max(stepWords.size, 1)
              }
              
              // Find best matching image for given text
              const findBestImage = (stepText, stepNum, usedUrls) => {
                if (!imageMappings || imageMappings.length === 0) return null
                
                let bestMatch = null
                let bestScore = 0
                
                for (const mapping of imageMappings) {
                  if (!mapping?.url || usedUrls.has(mapping.url)) continue
                  const context = mapping.context || ''
                  const score = getMatchScore(stepText, context)
                  
                  // Bonus: if context starts with the same step number
                  const contextStepMatch = context.match(/^(\d+)\./)
                  let adjustedScore = score
                  if (contextStepMatch && contextStepMatch[1] === String(stepNum)) {
                    adjustedScore += 0.5  // Big bonus for matching step numbers
                  }
                  
                  if (adjustedScore > bestScore) {
                    bestScore = adjustedScore
                    bestMatch = mapping
                  }
                }
                
                // Lower threshold - show image if any reasonable match
                return bestScore >= 0.15 ? bestMatch : null
              }
              
              // Clean up: remove citations and system text
              let cleaned = content
                .replace(/\[\d+\]/g, '')  // Remove all citations like [1], [2]
                .replace(/Available Images for this source:.*$/gm, '')
                .trim()
              
              // Track shown images
              const shownImageUrls = new Set()
              let totalImagesShown = 0
              
              // Split by lines to process numbered steps
              const lines = cleaned.split('\n')
              const outputLines = []
              
              for (const line of lines) {
                const trimmedLine = line.trim()
                if (!trimmedLine) continue
                
                // Check if it's a numbered step (1. text, 2. text, etc.)
                const stepMatch = trimmedLine.match(/^(\d+)\.\s*(.+)/)
                
                if (stepMatch) {
                  const [, num, stepText] = stepMatch
                  
                  // Add the step with clean styling
                  outputLines.push(`<div style="margin: 16px 0;"><div style="display: flex; align-items: flex-start; gap: 12px;"><span style="color: var(--brand); font-weight: 700; font-size: 16px; min-width: 24px;">${num}.</span><span style="line-height: 1.6;">${stepText.trim()}</span></div>`)
                  
                  // Find and add matching image below the step text
                  if (totalImagesShown < 8 && imageMappings?.length > 0) {
                    const bestImage = findBestImage(stepText, parseInt(num), shownImageUrls)
                    if (bestImage) {
                      shownImageUrls.add(bestImage.url)
                      totalImagesShown++
                      const imgSrc = bestImage.url.startsWith('http') ? bestImage.url : `${API_BASE}${bestImage.url}`
                      const escapedUrl = bestImage.url.replace(/'/g, "\\'")
                      outputLines.push(`<div style="margin: 12px 0 0 36px;"><img src="${imgSrc}" alt="Step ${num} illustration" style="max-width: 100%; max-height: 280px; border-radius: 6px; border: 1px solid #e5e7eb; cursor: pointer;" onclick="window.openInlineImage('${escapedUrl}')" onerror="this.parentElement.style.display='none';"/></div>`)
                    }
                  }
                  outputLines.push('</div>')
                } else if (trimmedLine.startsWith('•') || trimmedLine.startsWith('-')) {
                  // Bullet point
                  const bulletText = trimmedLine.replace(/^[•\-]\s*/, '')
                  outputLines.push(`<div style="margin: 8px 0 8px 24px; display: flex; align-items: flex-start; gap: 8px;"><span style="color: var(--brand);">•</span><span>${bulletText}</span></div>`)
                } else {
                  // Regular text (like intro or notes)
                  outputLines.push(`<div style="margin: 12px 0; line-height: 1.6;">${trimmedLine}</div>`)
                }
              }
              
              // Join and apply final formatting
              let formatted = outputLines.join('')
              formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              
              return formatted
            }
            
            return (
              <div key={idx}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    gap: 4,
                    marginBottom: 12
                  }}
                >
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: 18,
                      maxWidth: '75%',
                      background: msg.role === 'user' 
                        ? 'linear-gradient(180deg, var(--brand), var(--brand-2))'
                        : 'var(--panel-2)',
                      color: msg.role === 'user' ? 'white' : 'var(--text)',
                      border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
                      lineHeight: 1.6,
                      boxShadow: msg.role === 'user' ? '0 2px 8px rgba(0,174,239,0.2)' : '0 2px 4px rgba(0,0,0,0.05)'
                    }}
                    dangerouslySetInnerHTML={msg.role === 'assistant' ? { __html: formatAnswer(msg.content) } : undefined}
                  >
                    {msg.role === 'user' ? msg.content : null}
                  </div>
                  
                  {/* Rich Feedback UI for last assistant message */}
                  {isLastMessage && msg.role === 'assistant' && !loading && !showCreateTicket && (
                    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      
                      {!feedbackSubmitted && !showFeedbackForm ? (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Helpful?</span>
                          <button 
                            onClick={() => submitRichFeedback(5)}
                            style={{ border: '1px solid var(--border)', background: 'white', borderRadius: '12px', cursor: 'pointer', padding: '2px 8px' }}
                          >
                            👍
                          </button>
                          <button 
                            onClick={() => setShowFeedbackForm(true)}
                            style={{ border: '1px solid var(--border)', background: 'white', borderRadius: '12px', cursor: 'pointer', padding: '2px 8px' }}
                          >
                            👎
                          </button>
                          <div style={{ width: 1, height: 12, background: 'var(--border)', margin: '0 4px' }} />
                          <button
                            onClick={() => setShowCreateTicket(true)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--danger)',
                              cursor: 'pointer',
                              fontSize: 12,
                              padding: 0,
                              fontWeight: 500
                            }}
                          >
                            Not Satisfied? Create Ticket
                          </button>
                        </div>
                      ) : feedbackSubmitted ? (
                        <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>Thanks for your feedback!</span>
                      ) : (
                        <div style={{ 
                          background: 'var(--panel-2)', 
                          padding: 12, 
                          borderRadius: 8, 
                          border: '1px solid var(--border)',
                          maxWidth: '300px'
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>What was wrong?</div>
                          <select 
                            value={feedbackReason}
                            onChange={(e) => setFeedbackReason(e.target.value)}
                            style={{ width: '100%', marginBottom: 8, padding: 4, borderRadius: 4, border: '1px solid var(--border)' }}
                          >
                            <option value="">Select a reason...</option>
                            <option value="Inaccurate">Inaccurate</option>
                            <option value="Irrelevant">Irrelevant</option>
                            <option value="Outdated">Outdated</option>
                            <option value="Other">Other</option>
                          </select>
                          <textarea
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            placeholder="Additional comments..."
                            rows={2}
                            style={{ width: '100%', marginBottom: 8, padding: 4, borderRadius: 4, border: '1px solid var(--border)' }}
                          />
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button 
                              onClick={() => setShowFeedbackForm(false)}
                              style={{ fontSize: 11, padding: '4px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}
                            >
                              Cancel
                            </button>
                            <button 
                              onClick={() => submitRichFeedback(1, feedbackReason, feedback)}
                              disabled={!feedbackReason}
                              style={{ 
                                fontSize: 11, 
                                padding: '4px 8px', 
                                background: feedbackReason ? 'var(--brand)' : 'var(--muted)', 
                                color: 'white', 
                                border: 'none', 
                                borderRadius: 4, 
                                cursor: feedbackReason ? 'pointer' : 'not-allowed' 
                              }}
                            >
                              Submit
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          
          {/* Streaming answer display */}
          {isStreaming && streamingAnswer && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <div style={{ 
                padding: '12px 16px', 
                borderRadius: 18, 
                background: 'var(--panel-2)', 
                border: '1px solid var(--border)',
                lineHeight: 1.6,
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                maxWidth: '75%'
              }}>
                <div dangerouslySetInnerHTML={{ __html: (() => {
                  let formatted = streamingAnswer
                    // Markdown Images during streaming
                    .replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, url) => {
                      const imgSrc = url.startsWith('http') ? url : `${API_BASE}${url}`
                      const escapedUrl = url.replace(/'/g, "\\'")
                      return `<div style="margin: 12px 0; text-align: center;">
                        <img src="${imgSrc}" alt="${alt || 'Step illustration'}" 
                          style="max-width: 100%; max-height: 400px; border-radius: 8px; border: 1px solid var(--border); cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" 
                          onclick="window.openInlineImage('${escapedUrl}')"
                          onerror="this.style.display='none';"
                        />
                        ${alt ? `<div style="font-size: 11px; color: var(--muted); margin-top: 4px;">${alt}</div>` : ''}
                      </div>`
                    })
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/^(\d+)\.\s+(.+)$/gm, '<div style="margin: 8px 0; padding-left: 8px;">$1. $2</div>')
                    .replace(/^[-•]\s+(.+)$/gm, '<div style="margin: 8px 0; padding-left: 8px;">• $1</div>')
                    .replace(/\n/g, '<br/>')
                  return formatted
                })() }} />
                <span style={{ 
                  display: 'inline-block',
                  width: 8,
                  height: 14,
                  background: 'var(--brand)',
                  marginLeft: 4,
                  animation: 'blink 1s infinite',
                  verticalAlign: 'text-bottom'
                }} />
              </div>
            </div>
          )}

          {loading && !isStreaming && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <div style={{ 
                padding: '12px 16px', 
                borderRadius: 18, 
                background: 'var(--panel-2)', 
                border: '1px solid var(--border)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}>
                <div className="skeleton" style={{ width: '200px', marginBottom: 4 }} />
                <div className="skeleton" style={{ width: '150px' }} />
              </div>
            </div>
          )}

          {/* Suggested follow-up questions */}
          {suggestedQuestions.length > 0 && !loading && (
            <div style={{ 
              marginTop: 16, 
              padding: 16, 
              background: 'var(--panel-2)', 
              borderRadius: 10, 
              border: '1px solid var(--border)',
              maxWidth: '75%'
            }}>
              <h4 style={{ 
                margin: '0 0 12px 0', 
                fontSize: 13, 
                fontWeight: 600,
                color: 'var(--muted)' 
              }}>
                💡 Suggested follow-up questions:
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {suggestedQuestions.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSuggestedQuestion(q)}
                    style={{
                      padding: '10px 14px',
                      background: 'white',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 13,
                      color: 'var(--text)',
                      transition: 'all 0.2s',
                      fontWeight: 500
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = 'var(--brand)'
                      e.target.style.color = 'white'
                      e.target.style.borderColor = 'var(--brand)'
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'white'
                      e.target.style.color = 'var(--text)'
                      e.target.style.borderColor = 'var(--border)'
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showCreateTicket && (
            <div style={{ 
              marginTop: 8, 
              padding: 16, 
              background: 'var(--panel-2)', 
              borderRadius: 10, 
              border: '1px solid var(--border)',
              maxWidth: '75%'
            }}>
              <h4 style={{ marginTop: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 }}>Create Support Ticket</h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
                    Title <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={ticketTitle}
                    onChange={(e) => setTicketTitle(e.target.value)}
                    placeholder="Brief title of the issue"
                    style={{ width: '100%', padding: 8, background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }}
                  />
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
                    Category <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <select
                    value={ticketCategory}
                    onChange={(e) => setTicketCategory(e.target.value)}
                    style={{ width: '100%', padding: 8, background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }}
                  >
                    <option value="">Select a category</option>
                    <option value="Bug">Bug</option>
                    <option value="Feature Request">Feature Request</option>
                    <option value="Question">Question</option>
                    <option value="Incident">Incident</option>
                    <option value="Change Request">Change Request</option>
                  </select>
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
                    Severity
                  </label>
                  <input
                    type="text"
                    value="Medium"
                    disabled
                    style={{ width: '100%', padding: 8, background: 'var(--panel-2)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, cursor: 'not-allowed' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>Set by support team</span>
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
                    Description <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <textarea
                    value={ticketDescription}
                    onChange={(e) => setTicketDescription(e.target.value)}
                    placeholder="Please provide a detailed description of the issue..."
                    rows={4}
                    style={{ width: '100%', padding: 8, background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, resize: 'vertical' }}
                  />
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
                    Reason for Ticket <span style={{ color: 'var(--muted)' }}>(Why are you creating this ticket?)</span>
                  </label>
                  <textarea
                    value={ticketReason}
                    onChange={(e) => setTicketReason(e.target.value)}
                    placeholder="e.g., The answer doesn't address my specific use case..."
                    rows={2}
                    style={{ width: '100%', padding: 8, background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, resize: 'vertical' }}
                  />
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
                    Additional Notes (Optional)
                  </label>
                  <textarea
                    value={additionalNotes}
                    onChange={(e) => setAdditionalNotes(e.target.value)}
                    placeholder="Any extra context, steps to reproduce, expected behavior..."
                    rows={3}
                    style={{ width: '100%', padding: 8, background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, resize: 'vertical' }}
                  />
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
                    Attachments (PDF, PNG, JPG, JPEG)
                  </label>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleFileSelect}
                    style={{ width: '100%', padding: 8, background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }}
                  />
                  {selectedFiles.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {selectedFiles.map((file, idx) => (
                        <div key={idx} style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          padding: '6px 8px',
                          background: 'var(--panel)',
                          borderRadius: 4,
                          fontSize: 12
                        }}>
                          <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {file.name} ({(file.size / 1024).toFixed(1)} KB)
                          </span>
                          <button
                            onClick={() => removeFile(idx)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--danger)',
                              cursor: 'pointer',
                              fontSize: 14,
                              padding: '0 8px'
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setShowCreateTicket(false)
                    setTicketTitle('')
                    setTicketCategory('')
                    setTicketDescription('')
                    setTicketReason('')
                    setAdditionalNotes('')
                    setSelectedFiles([])
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontSize: 13,
                    padding: '8px 16px',
                    borderRadius: 6,
                    fontWeight: 500
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={createSupportTicket}
                  disabled={!ticketTitle.trim() || !ticketCategory || !ticketDescription.trim() || uploadingFiles}
                  className="btn"
                  style={{ fontSize: 13, padding: '8px 16px', opacity: (!ticketTitle.trim() || !ticketCategory || !ticketDescription.trim() || uploadingFiles) ? 0.6 : 1 }}
                >
                  {uploadingFiles ? 'Uploading...' : 'Create Ticket'}
                </button>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
        
        {/* Follow-up Question Input - Fixed at bottom of conversation */}
        {conversationHistory.length > 0 && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '12px 16px',
            background: 'white',
            borderTop: '1px solid var(--border)',
            borderRadius: '0 0 12px 12px'
          }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !loading) {
                    e.preventDefault()
                    onAsk(e)
                  }
                }}
                placeholder="Ask a follow-up question..."
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--brand)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
              />
              <button
                onClick={onAsk}
                disabled={loading || !question.trim()}
                style={{
                  padding: '10px 20px',
                  background: loading || !question.trim() ? 'var(--muted)' : 'var(--brand)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: loading || !question.trim() ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 500,
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap'
                }}
              >
                {loading ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Media Display - Images and Videos */}
      {(mediaImages.length > 0 || mediaVideos.length > 0) && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: 0, marginBottom: 12 }}>Related Media</h3>
          
          {/* Images */}
          {mediaImages.length > 0 && (
            <div style={{ marginBottom: mediaVideos.length > 0 ? 16 : 0 }}>
              <h4 style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 8 }}>Images ({mediaImages.length})</h4>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
                gap: 12 
              }}>
                {mediaImages.map((imgUrl, idx) => (
                  <div 
                    key={idx} 
                    onClick={() => setSelectedImage(imgUrl)}
                    style={{ 
                      cursor: 'pointer',
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: '1px solid var(--border)',
                      transition: 'transform 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <img 
                      src={`${API_BASE}${imgUrl}`} 
                      alt={`Related image ${idx + 1}`}
                      style={{ 
                        width: '100%', 
                        height: '150px', 
                        objectFit: 'cover',
                        display: 'block'
                      }}
                      onError={(e) => {
                        e.target.style.display = 'none'
                        e.target.parentElement.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Image unavailable</div>'
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Videos */}
          {mediaVideos.length > 0 && (
            <div>
              <h4 style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 8 }}>Videos ({mediaVideos.length})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {mediaVideos.map((vidUrl, idx) => (
                  <div 
                    key={idx}
                    style={{ 
                      position: 'relative',
                      paddingBottom: '56.25%', // 16:9 aspect ratio
                      height: 0,
                      overflow: 'hidden',
                      borderRadius: 8,
                      border: '1px solid var(--border)'
                    }}
                  >
                    <iframe
                      src={vidUrl}
                      title={`Related video ${idx + 1}`}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%'
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Image Lightbox */}
      {selectedImage && (
        <div 
          onClick={() => setSelectedImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'pointer',
            padding: '40px'
          }}
        >
          <div style={{ 
            position: 'relative', 
            maxWidth: '100%', 
            maxHeight: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setSelectedImage(null)
              }}
              style={{
                position: 'absolute',
                top: -50,
                right: 0,
                background: 'white',
                border: 'none',
                borderRadius: '50%',
                width: 36,
                height: 36,
                fontSize: 24,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                zIndex: 10000
              }}
            >
              ×
            </button>
            <img 
              src={`${API_BASE}${selectedImage}`} 
              alt="Full size"
              style={{ 
                maxWidth: '100%', 
                maxHeight: 'calc(100vh - 80px)',
                width: 'auto',
                height: 'auto',
                minWidth: '300px',
                objectFit: 'contain',
                borderRadius: 8,
                boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                backgroundColor: 'white'
              }}
              onError={(e) => {
                console.error('Failed to load image:', selectedImage)
                e.target.style.backgroundColor = '#f0f0f0'
                e.target.alt = 'Failed to load image'
              }}
            />
          </div>
        </div>
      )}

      {/* Sources and Ticket History - Side by Side */}
      <div className="grid" style={{ marginBottom: 16 }}>
        {/* Left: Sources */}
        <div className="section" style={{ minHeight: '300px', maxHeight: '400px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Sources</h3>
            {sources.length > 1 && (
              <button
                onClick={() => setSourcesExpanded(!sourcesExpanded)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 6,
                  fontWeight: 500
                }}
              >
                {sourcesExpanded ? 'Collapse' : `Show all (${sources.length})`}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sources.length === 0 && <span className="muted">No sources yet.</span>}
            {(sourcesExpanded ? sources : sources.slice(0, 1)).map((s, i) => {
              const actualIndex = sourcesExpanded ? i : 0
              const chunk = chunks[actualIndex] || null
              return (
                <div
                  key={actualIndex}
                  onClick={() => chunk && setSelectedSource(selectedSource === actualIndex ? null : actualIndex)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    background: selectedSource === actualIndex ? 'rgba(0,174,239,0.1)' : 'var(--panel-2)',
                    border: selectedSource === actualIndex ? '2px solid var(--brand)' : '1px solid var(--border)',
                    borderRadius: 8,
                    cursor: chunk ? 'pointer' : 'default',
                    transition: 'all 0.2s',
                  }}
                  title={chunk ? "Click to view content" : ""}
                >
                  <span style={{ color: 'var(--text)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.source}</span>
                  <span style={{ color: 'var(--brand)', fontVariantNumeric: 'tabular-nums', fontSize: 12, marginLeft: 8 }}>
                    {typeof s.score === 'number' ? s.score.toFixed(3) : s.score}
                  </span>
                </div>
              )
            })}
          </div>

          {selectedSource !== null && chunks[selectedSource] && (
            <div style={{
              marginTop: 16,
              padding: 14,
              background: 'var(--panel-2)',
              borderRadius: 10,
              border: '1px solid var(--border)',
              maxHeight: '200px',
              overflowY: 'auto'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h4 style={{ margin: 0, fontSize: 13, color: 'var(--text)' }}>
                  Content from: {sources[selectedSource]?.source}
                </h4>
                <button
                  onClick={() => setSelectedSource(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontSize: 18,
                    padding: '0 4px'
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 12, color: 'var(--text)' }}>
                {chunks[selectedSource]}
              </div>
            </div>
          )}
        </div>

        {/* Right: Ticket History */}
        <div className="section" style={{ minHeight: '300px', maxHeight: '400px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Ticket History</h3>
            <button
              onClick={() => {
                setShowTickets(!showTickets)
                if (!showTickets) loadTickets()
              }}
              className="btn"
              style={{ fontSize: 12, padding: '6px 12px' }}
            >
              {showTickets ? 'Hide' : 'Show'} Tickets
            </button>
          </div>
          {showTickets && (
            <div>
              {tickets.length === 0 ? (
                <div className="muted">No tickets yet.</div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {tickets.map((t) => (
                    <div key={t.id} style={{ padding: 12, background: 'var(--panel-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                        {t.id} • {new Date(t.created_at).toLocaleString()}
                      </div>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Q: {t.question}</div>
                      {t.answer && <div style={{ marginBottom: 8, fontSize: 14 }}>A: {t.answer}</div>}
                      {t.feedback && (
                                <div style={{ marginTop: 8, padding: 8, background: 'rgba(0,174,239,0.1)', borderRadius: 6, fontSize: 12 }}>
                          <strong>Feedback:</strong> {t.feedback}
                          {t.rating && <span style={{ marginLeft: 8 }}>⭐ {t.rating}/5</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!showTickets && (
            <div className="muted" style={{ textAlign: 'center', padding: '40px 0' }}>
              Click "Show Tickets" to view ticket history
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
