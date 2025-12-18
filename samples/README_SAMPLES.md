# Sample Documents for Multi-Modal RAG

This directory contains sample documents demonstrating multi-modal RAG capabilities.

## Files Included

### HTML Files
- **feature_guide.html** - Comprehensive guide with embedded YouTube video tutorial
- **quick_start.html** - Quick start guide with references to local images and videos

### Text Files
All existing `.txt` files are preserved and continue to work with the system.

## Adding Your Own Documents

### HTML Documents
1. Create HTML files with standard structure
2. Embed images using `<img src="image.png">` tags
3. Embed YouTube videos using `<iframe>` with YouTube embed URLs
4. Place images in the same directory or use full URLs

### PDF Documents
1. Add PDF files to this directory
2. The system will automatically extract text and embedded images
3. Extracted images will be served automatically

### Text Documents
1. Plain text files continue to work as before
2. Simply add `.txt` files to this directory

## Image References

For local images referenced in HTML files:
- Place images in the `samples/` directory
- Reference them with relative paths: `<img src="dashboard-screenshot.png">`
- The system serves them via `/media/dashboard-screenshot.png`

## External Media

For external images and videos:
- Use full URLs: `<img src="https://example.com/image.jpg">`
- Use YouTube embed URLs: `<iframe src="https://www.youtube.com/embed/VIDEO_ID">`

## Notes

- Images are extracted from PDFs automatically
- Videos must be from supported platforms (YouTube, Vimeo) or hosted externally
- All media is associated with text chunks for semantic search


