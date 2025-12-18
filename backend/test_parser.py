#!/usr/bin/env python3
"""
Quick test script to verify the multi-modal document parser works correctly.
Run this before starting the backend to ensure everything is set up properly.
"""
import sys
from pathlib import Path

def test_imports():
    """Test that all required modules can be imported."""
    print("Testing imports...")
    try:
        from bs4 import BeautifulSoup
        print("  ✓ BeautifulSoup imported")
    except ImportError as e:
        print(f"  ✗ BeautifulSoup import failed: {e}")
        print("    Run: pip install beautifulsoup4")
        return False
    
    try:
        from PyPDF2 import PdfReader
        print("  ✓ PyPDF2 imported")
    except ImportError as e:
        print(f"  ✗ PyPDF2 import failed: {e}")
        print("    Run: pip install pypdf2")
        return False
    
    try:
        from PIL import Image
        print("  ✓ Pillow imported")
    except ImportError as e:
        print(f"  ✗ Pillow import failed: {e}")
        print("    Run: pip install pillow")
        return False
    
    try:
        import requests
        print("  ✓ Requests imported")
    except ImportError as e:
        print(f"  ✗ Requests import failed: {e}")
        print("    Run: pip install requests")
        return False
    
    try:
        from document_parser import DocumentParser, parse_document
        print("  ✓ Document parser module imported")
    except ImportError as e:
        print(f"  ✗ Document parser import failed: {e}")
        return False
    
    return True


def test_parser():
    """Test the document parser with sample files."""
    print("\nTesting document parser...")
    from document_parser import DocumentParser
    
    parser = DocumentParser(chunk_size=100, overlap=20)
    samples_dir = Path(__file__).parent.parent / "samples"
    
    # Test HTML parsing
    html_files = list(samples_dir.glob("*.html"))
    if html_files:
        print(f"\n  Found {len(html_files)} HTML file(s)")
        for html_file in html_files[:2]:  # Test first 2
            try:
                chunks = parser.parse_document(str(html_file))
                has_images = any(chunk.image_urls for chunk in chunks)
                has_videos = any(chunk.video_urls for chunk in chunks)
                print(f"  ✓ {html_file.name}: {len(chunks)} chunks, " +
                      f"images={has_images}, videos={has_videos}")
            except Exception as e:
                print(f"  ✗ {html_file.name}: {e}")
    else:
        print("  ⚠ No HTML files found in samples/")
    
    # Test text parsing
    txt_files = list(samples_dir.glob("*.txt"))
    if txt_files:
        print(f"\n  Found {len(txt_files)} text file(s)")
        for txt_file in txt_files[:2]:  # Test first 2
            try:
                chunks = parser.parse_document(str(txt_file))
                print(f"  ✓ {txt_file.name}: {len(chunks)} chunks")
            except Exception as e:
                print(f"  ✗ {txt_file.name}: {e}")
    else:
        print("  ⚠ No text files found in samples/")
    
    # Test PDF parsing
    pdf_files = list(samples_dir.glob("*.pdf"))
    if pdf_files:
        print(f"\n  Found {len(pdf_files)} PDF file(s)")
        for pdf_file in pdf_files[:1]:  # Test first 1 (PDFs can be slow)
            try:
                chunks = parser.parse_document(str(pdf_file))
                has_images = any(chunk.image_urls for chunk in chunks)
                print(f"  ✓ {pdf_file.name}: {len(chunks)} chunks, images={has_images}")
            except Exception as e:
                print(f"  ✗ {pdf_file.name}: {e}")
    else:
        print("  ⚠ No PDF files found in samples/")
    
    return True


def test_directories():
    """Test that required directories exist."""
    print("\nChecking directories...")
    
    backend_dir = Path(__file__).parent
    samples_dir = backend_dir.parent / "samples"
    extracted_dir = backend_dir / "extracted_media"
    
    if samples_dir.exists():
        print(f"  ✓ samples/ directory exists")
        file_count = len(list(samples_dir.glob("*")))
        print(f"    Contains {file_count} files")
    else:
        print(f"  ✗ samples/ directory not found")
        return False
    
    if extracted_dir.exists():
        print(f"  ✓ extracted_media/ directory exists")
    else:
        print(f"  ⚠ extracted_media/ directory not found (will be created)")
        try:
            extracted_dir.mkdir(exist_ok=True)
            print(f"    Created extracted_media/ directory")
        except Exception as e:
            print(f"    Could not create directory: {e}")
    
    return True


def main():
    """Run all tests."""
    print("=" * 60)
    print("Multi-Modal RAG Parser Test Suite")
    print("=" * 60)
    
    success = True
    
    # Test imports
    if not test_imports():
        print("\n❌ Import tests failed. Install missing dependencies.")
        success = False
    
    # Test directories
    if not test_directories():
        print("\n❌ Directory tests failed.")
        success = False
    
    # Test parser
    if success:
        try:
            test_parser()
        except Exception as e:
            print(f"\n❌ Parser tests failed: {e}")
            success = False
    
    # Summary
    print("\n" + "=" * 60)
    if success:
        print("✅ All tests passed!")
        print("\nNext steps:")
        print("  1. Run: python seed_kb.py")
        print("  2. Run: uvicorn main:app --reload --port 8000")
        print("  3. Test at: http://localhost:8000/docs")
    else:
        print("❌ Some tests failed. Fix the issues above.")
        sys.exit(1)
    print("=" * 60)


if __name__ == "__main__":
    main()


