#!/usr/bin/env python3
"""
Multi-modal document parser for RAG system.
Supports HTML, PDF, TXT files and URLs.
Extracts text chunks along with associated images and videos.
"""
import os
import re
from pathlib import Path
from typing import List, Dict, Any, Optional
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup
from PyPDF2 import PdfReader
from PIL import Image
import io


class DocumentChunk:
    """Represents a chunk of text with associated media."""
    def __init__(
        self,
        text: str,
        source: str,
        image_urls: List[str] = None,
        video_urls: List[str] = None,
        source_doc: str = None,
    ):
        self.text = text
        self.source = source
        self.image_urls = image_urls or []
        self.video_urls = video_urls or []
        self.source_doc = source_doc or source

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "source": self.source,
            "image_urls": self.image_urls,
            "video_urls": self.video_urls,
            "source_doc": self.source_doc,
        }


class DocumentParser:
    """Multi-modal document parser."""
    
    def __init__(self, chunk_size: int = 1000, overlap: int = 200):
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.extracted_media_dir = Path(__file__).parent / "extracted_media"
        self.extracted_media_dir.mkdir(exist_ok=True)

    def parse_document(self, path: str, is_url: bool = False) -> List[DocumentChunk]:
        """
        Parse a document and return chunks with media references.
        
        Args:
            path: File path or URL
            is_url: True if path is a URL
        
        Returns:
            List of DocumentChunk objects
        """
        if is_url:
            return self._parse_url(path)
        
        path_obj = Path(path)
        ext = path_obj.suffix.lower()
        
        if ext == '.html' or ext == '.htm':
            return self._parse_html_file(path_obj)
        elif ext == '.pdf':
            return self._parse_pdf(path_obj)
        elif ext == '.txt':
            return self._parse_text(path_obj)
        else:
            raise ValueError(f"Unsupported file type: {ext}")

    def _parse_url(self, url: str) -> List[DocumentChunk]:
        """Fetch and parse HTML from URL."""
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            return self._extract_from_html(soup, source_name=url, base_url=url)
        except Exception as e:
            print(f"Error fetching URL {url}: {e}")
            return []

    def _parse_html_file(self, file_path: Path) -> List[DocumentChunk]:
        """Parse HTML file and extract text chunks with media."""
        with open(file_path, 'r', encoding='utf-8') as f:
            soup = BeautifulSoup(f.read(), 'html.parser')
        
        # Base URL for relative paths (file's directory)
        base_path = file_path.parent
        return self._extract_from_html(
            soup, 
            source_name=f"kb/{file_path.name}",
            base_url=str(base_path),
            is_local=True
        )

    def _extract_from_html(
        self, 
        soup: BeautifulSoup, 
        source_name: str,
        base_url: str = "",
        is_local: bool = False
    ) -> List[DocumentChunk]:
        """Extract text chunks and media from BeautifulSoup object."""
        # Remove script and style tags
        for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
            tag.decompose()
        
        chunks = []
        
        # Find logical content sections (divs, sections, articles)
        content_sections = soup.find_all(['div', 'section', 'article', 'main', 'body'])
        
        if not content_sections:
            content_sections = [soup]
        
        for section in content_sections:
            # Get text from this section
            text = section.get_text(separator=' ', strip=True)
            text = ' '.join(text.split())  # Normalize whitespace
            
            if not text or len(text) < 50:  # Skip very short sections
                continue
            
            # Find images within this section
            images = section.find_all('img')
            image_urls = []
            for img in images:
                src = img.get('src', '')
                if src:
                    # Skip tiny icons (bullet points, etc) - they're not useful
                    if any(skip in src.lower() for skip in ['bullet', 'icon', 'spacer', 'transparent', '1x1']):
                        # Check if it's actually tiny by size
                        width = img.get('width', '')
                        height = img.get('height', '')
                        try:
                            if (width and int(width) < 20) or (height and int(height) < 20):
                                continue  # Skip tiny decorative images
                        except (ValueError, TypeError):
                            # If we can't parse dimensions but name suggests icon, skip it
                            if 'icon' in src.lower() or 'bullet' in src.lower():
                                continue
                    
                    # Handle relative URLs
                    if is_local and not src.startswith(('http://', 'https://', '/')):
                        # For local files, convert to relative media path
                        image_urls.append(f"/media/{src}")
                    elif not src.startswith(('http://', 'https://')):
                        image_urls.append(urljoin(base_url, src))
                    else:
                        image_urls.append(src)
            
            # Find videos within this section
            video_urls = []
            
            # YouTube/Vimeo iframes
            iframes = section.find_all('iframe')
            for iframe in iframes:
                src = iframe.get('src', '')
                if src and any(x in src for x in ['youtube.com', 'youtu.be', 'vimeo.com']):
                    # Ensure embed format for YouTube
                    if 'youtube.com/watch' in src:
                        video_id = src.split('v=')[1].split('&')[0]
                        src = f"https://www.youtube.com/embed/{video_id}"
                    elif 'youtu.be/' in src:
                        video_id = src.split('youtu.be/')[1].split('?')[0]
                        src = f"https://www.youtube.com/embed/{video_id}"
                    video_urls.append(src)
            
            # HTML5 video tags
            videos = section.find_all('video')
            for video in videos:
                sources = video.find_all('source')
                for source in sources:
                    src = source.get('src', '')
                    if src:
                        if is_local and not src.startswith(('http://', 'https://', '/')):
                            video_urls.append(f"/media/{src}")
                        elif not src.startswith(('http://', 'https://')):
                            video_urls.append(urljoin(base_url, src))
                        else:
                            video_urls.append(src)
            
            # Chunk the text
            text_chunks = self._chunk_text(text)
            
            # Create chunks - associate media with ALL text chunks from this section
            # This ensures images appear regardless of which chunk matches the search query
            for i, chunk_text in enumerate(text_chunks):
                chunk = DocumentChunk(
                    text=chunk_text,
                    source=f"{source_name}#section-{len(chunks)}",
                    image_urls=image_urls,  # Attach media to ALL chunks
                    video_urls=video_urls,  # Attach media to ALL chunks
                    source_doc=source_name,
                )
                chunks.append(chunk)
        
        return chunks

    def _parse_pdf(self, file_path: Path) -> List[DocumentChunk]:
        """Parse PDF and extract text chunks with embedded images."""
        chunks = []
        
        try:
            reader = PdfReader(str(file_path))
            
            # Extract images from PDF
            image_urls = []
            for page_num, page in enumerate(reader.pages):
                if '/XObject' in page['/Resources']:
                    xObject = page['/Resources']['/XObject'].get_object()
                    
                    for obj_name in xObject:
                        obj = xObject[obj_name]
                        
                        if obj['/Subtype'] == '/Image':
                            try:
                                # Extract image data
                                size = (obj['/Width'], obj['/Height'])
                                data = obj.get_data()
                                
                                # Save image
                                img_filename = f"{file_path.stem}_page{page_num}_{obj_name[1:]}.png"
                                img_path = self.extracted_media_dir / img_filename
                                
                                # Try to create PIL image
                                if obj['/ColorSpace'] == '/DeviceRGB':
                                    img = Image.frombytes('RGB', size, data)
                                elif obj['/ColorSpace'] == '/DeviceGray':
                                    img = Image.frombytes('L', size, data)
                                else:
                                    continue
                                
                                img.save(img_path)
                                image_urls.append(f"/media/extracted_media/{img_filename}")
                            except Exception as e:
                                print(f"Could not extract image from PDF: {e}")
                                continue
            
            # Extract text from all pages
            full_text = ""
            for page in reader.pages:
                full_text += page.extract_text() + "\n\n"
            
            full_text = ' '.join(full_text.split())  # Normalize whitespace
            
            # Chunk the text
            text_chunks = self._chunk_text(full_text)
            
            # Create chunks with images attached to first chunk
            for i, chunk_text in enumerate(text_chunks):
                chunk = DocumentChunk(
                    text=chunk_text,
                    source=f"kb/{file_path.name}#page-{i+1}",
                    image_urls=image_urls if i == 0 else [],
                    video_urls=[],
                    source_doc=f"kb/{file_path.name}",
                )
                chunks.append(chunk)
        
        except Exception as e:
            print(f"Error parsing PDF {file_path}: {e}")
        
        return chunks

    def _parse_text(self, file_path: Path) -> List[DocumentChunk]:
        """Parse plain text file (backward compatibility)."""
        with open(file_path, 'r', encoding='utf-8') as f:
            text = f.read().strip()
        
        text = ' '.join(text.split())  # Normalize whitespace
        text_chunks = self._chunk_text(text)
        
        chunks = []
        for i, chunk_text in enumerate(text_chunks):
            chunk = DocumentChunk(
                text=chunk_text,
                source=f"kb/{file_path.name}#chunk-{i+1}",
                image_urls=[],
                video_urls=[],
                source_doc=f"kb/{file_path.name}",
            )
            chunks.append(chunk)
        
        return chunks

    def _chunk_text(self, text: str) -> List[str]:
        """Split text into chunks with overlap."""
        if not text:
            return []
        
        chunks = []
        start = 0
        
        while start < len(text):
            end = min(len(text), start + self.chunk_size)
            chunk = text[start:end]
            
            if chunk.strip():
                chunks.append(chunk)
            
            if end == len(text):
                break
            
            start = max(0, end - self.overlap)
        
        return chunks


# Convenience functions for external use
def parse_document(path: str, is_url: bool = False, chunk_size: int = 1000, overlap: int = 200) -> List[DocumentChunk]:
    """Parse a document and return chunks with media."""
    parser = DocumentParser(chunk_size=chunk_size, overlap=overlap)
    return parser.parse_document(path, is_url=is_url)


def parse_directory(directory: Path, extensions: List[str] = None) -> List[DocumentChunk]:
    """Parse all supported documents in a directory."""
    if extensions is None:
        extensions = ['.txt', '.html', '.htm', '.pdf']
    
    parser = DocumentParser()
    all_chunks = []
    
    for ext in extensions:
        for file_path in directory.glob(f"*{ext}"):
            try:
                chunks = parser.parse_document(str(file_path))
                all_chunks.extend(chunks)
                print(f"✓ Parsed {file_path.name}: {len(chunks)} chunks")
            except Exception as e:
                print(f"✗ Error parsing {file_path.name}: {e}")
    
    return all_chunks

