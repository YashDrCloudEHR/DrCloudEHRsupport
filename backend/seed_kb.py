#!/usr/bin/env python3
"""
Seed the knowledge base with initial documents from the samples/ directory.
Supports multi-modal content: .txt, .html, .pdf files with embedded media.
Run this once to populate your Qdrant collection with company knowledge base content.
"""
import json
import os
import sys
from pathlib import Path
from urllib import request

# Import the new document parser
from document_parser import parse_directory

ROOT = Path(__file__).parent.parent
SAMPLES_DIR = ROOT / "samples"
API_BASE = os.environ.get("API_BASE", "http://localhost:8000")


def seed_from_directory(directory: Path = SAMPLES_DIR):
    """Read all supported files from directory and seed them to the knowledge base."""
    if not directory.exists():
        print(f"Directory {directory} does not exist. Creating it...")
        directory.mkdir(parents=True, exist_ok=True)
        print(f"Created {directory}. Add documents there and run this script again.")
        return

    # Check for supported files
    supported_files = list(directory.glob("*.txt")) + list(directory.glob("*.html")) + \
                      list(directory.glob("*.htm")) + list(directory.glob("*.pdf"))
    
    if not supported_files:
        print(f"No supported files found in {directory}")
        print(f"Supported formats: .txt, .html, .htm, .pdf")
        print(f"Add documents to {directory} and run this script again.")
        return

    print(f"Found {len(supported_files)} document(s) to process:\n")
    
    # Parse all documents using the multi-modal parser
    try:
        chunks = parse_directory(directory, extensions=['.txt', '.html', '.htm', '.pdf'])
    except Exception as e:
        print(f"✗ Error parsing documents: {e}")
        sys.exit(1)

    if not chunks:
        print("\n⚠ No content extracted from documents.")
        return

    # Convert chunks to API format
    items = []
    for chunk in chunks:
        chunk_dict = chunk.to_dict()
        items.append({
            "text": chunk_dict["text"],
            "source": chunk_dict["source"],
            "metadata": {
                "image_urls": chunk_dict["image_urls"],
                "video_urls": chunk_dict["video_urls"],
                "source_doc": chunk_dict["source_doc"],
                "image_mappings": chunk_dict.get("image_mappings", []),  # NEW: Images with context
            }
        })

    print(f"\n✓ Total chunks extracted: {len(items)}")
    print(f"  - Text chunks: {len(items)}")
    print(f"  - With images: {sum(1 for item in items if item['metadata']['image_urls'])}")
    print(f"  - With videos: {sum(1 for item in items if item['metadata']['video_urls'])}")

    # Send to API in batches to avoid token limits
    upsert_url = f"{API_BASE}/upsert"
    batch_size = 50  # Send 50 chunks at a time
    total_upserted = 0
    
    print(f"\nSending in batches of {batch_size}...")
    
    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (len(items) + batch_size - 1) // batch_size
        
        data = json.dumps({"items": batch}).encode("utf-8")
        req = request.Request(
            upsert_url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with request.urlopen(req, timeout=120) as resp:
                body = resp.read().decode("utf-8")
                result = json.loads(body)
                upserted = result.get('upserted', 0)
                total_upserted += upserted
                print(f"  ✓ Batch {batch_num}/{total_batches}: Upserted {upserted} chunks")
        except request.HTTPError as e:
            error_body = e.read().decode("utf-8")
            print(f"  ✗ Batch {batch_num}/{total_batches} failed - HTTP {e.code}: {error_body}")
            print(f"\n✓ Partial success: {total_upserted} chunks upserted before error")
            sys.exit(1)
        except Exception as e:
            print(f"  ✗ Batch {batch_num}/{total_batches} failed: {e}")
            print(f"  Make sure the backend is running at {API_BASE}")
            print(f"\n✓ Partial success: {total_upserted} chunks upserted before error")
            sys.exit(1)
    
    print(f"\n✓ Successfully seeded {total_upserted} chunks to knowledge base")


if __name__ == "__main__":
    print("=" * 60)
    print("Multi-Modal Knowledge Base Seeding")
    print("=" * 60)
    print("\nSupported formats: .txt, .html, .pdf")
    print("Extracts: text, images, videos\n")
    seed_from_directory()
    print("\n" + "=" * 60)
    print("Done! You can now ask questions in the app.")
    print("=" * 60)

