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
  const [showCreateTicket, setShowCreateTicket] = useState(false)
  const [ticketReason, setTicketReason] = useState('')
  const [ticketTitle, setTicketTitle] = useState('')
  const [ticketCategory, setTicketCategory] = useState('')
  const [ticketDescription, setTicketDescription] = useState('')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [logoError, setLogoError] = useState(false)
  const [userId, setUserId] = useState(null)
  const [siteId, setSiteId] = useState(null)
  const [userTags, setUserTags] = useState([])
  const chatEndRef = useRef(null)

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

  async function onAsk(e) {
    e.preventDefault()
    const currentQuestion = question.trim()
    if (!currentQuestion) return

    setLoading(true)
    setError(null)
    setAnswer(null)
    setSources([])
    setChunks([])
    setTicketId(null)
    setFeedback('')
    setRating(null)
    setFeedbackSubmitted(false)
    setSelectedSource(null)
    setShowCreateTicket(false)

    // Add user question to conversation history
    const userMessage = { role: 'user', content: currentQuestion }
    const updatedHistory = [...conversationHistory, userMessage]

    try {
      const headers = {
        'Content-Type': 'application/json',
      }
      
      // Add user context headers
      if (userId) headers['X-User-ID'] = userId
      if (siteId) headers['X-Site-ID'] = siteId
      if (userTags.length) headers['X-Tags'] = userTags.join(',')
      
      const res = await fetchWithTimeout(`${API_BASE}/ask`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          question: currentQuestion,
          use_llm: true, // Always use LLM
          top_k: 5,
          conversation_history: conversationHistory,
          user_id: userId,  // Also in body as fallback
          site_id: siteId,
          tags: userTags,
        }),
      }, 30000)
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const answerText = data.answer ?? null
      setAnswer(answerText)
      setSources(Array.isArray(data.sources) ? data.sources : [])
      setChunks(Array.isArray(data.chunks) ? data.chunks : [])
      setTicketId(data.ticket_id || null)

      // Add assistant response to conversation history
      if (answerText) {
        setConversationHistory([...updatedHistory, { role: 'assistant', content: answerText }])
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
    }
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
        <div>
          <div className="title">DrCloudEHR Support</div>
          <div className="subtitle">
            Ask questions over our knowledge base
            {backendStatus === 'online' && <span style={{ color: 'var(--success)', marginLeft: 8 }}>● Backend online</span>}
            {backendStatus === 'offline' && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>● Backend offline</span>}
            {backendStatus === 'checking' && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>● Checking...</span>}
          </div>
        </div>
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
            
            // Format answer text to be more readable
            const formatAnswer = (content) => {
              if (msg.role === 'user') return content
              
              // Convert markdown-style formatting to HTML
              let formatted = content
                // Bold text **text** -> <strong>
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                // Numbered lists
                .replace(/^(\d+)\.\s+(.+)$/gm, '<div style="margin: 8px 0; padding-left: 8px;">$1. $2</div>')
                // Bullet points
                .replace(/^[-•]\s+(.+)$/gm, '<div style="margin: 8px 0; padding-left: 8px;">• $1</div>')
                // Line breaks
                .replace(/\n/g, '<br/>')
              
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
                  {isLastMessage && msg.role === 'assistant' && !showCreateTicket && (
                    <button
                      onClick={() => setShowCreateTicket(true)}
                      style={{
                        marginTop: 8,
                        background: 'transparent',
                        border: '1px solid var(--danger)',
                        color: 'var(--danger)',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: '6px 12px',
                        borderRadius: 6,
                        fontWeight: 500
                      }}
                    >
                      Not Satisfied? Create Ticket
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          
          {loading && (
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
                    Additional Notes (Optional)
                  </label>
                  <textarea
                    value={ticketReason}
                    onChange={(e) => setTicketReason(e.target.value)}
                    placeholder="Any additional information..."
                    rows={2}
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
