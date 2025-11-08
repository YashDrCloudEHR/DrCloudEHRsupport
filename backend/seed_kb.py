#!/usr/bin/env python3
"""
Seed the knowledge base with initial documents from the samples/ directory.
Run this once to populate your Qdrant collection with company knowledge base content.
"""
import json
import os
import sys
from pathlib import Path
from urllib import request

ROOT = Path(__file__).parent.parent
SAMPLES_DIR = ROOT / "samples"
API_BASE = os.environ.get("API_BASE", "http://localhost:8000")


def read_text_file(path: Path) -> str:
    """Read a text file and return its content."""
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list:
    """Split text into chunks with overlap for better context."""
    text = " ".join(text.split())  # Normalize whitespace
    if not text:
        return []
    
    chunks = []
    start = 0
    while start < len(text):
        end = min(len(text), start + chunk_size)
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk)
        if end == len(text):
            break
        start = max(0, end - overlap)
    return chunks


def seed_from_directory(directory: Path = SAMPLES_DIR):
    """Read all .txt files from directory and seed them to the knowledge base."""
    if not directory.exists():
        print(f"Directory {directory} does not exist. Creating it...")
        directory.mkdir(parents=True, exist_ok=True)
        print(f"Created {directory}. Add .txt files there and run this script again.")
        return

    txt_files = list(directory.glob("*.txt"))
    if not txt_files:
        print(f"No .txt files found in {directory}")
        print(f"Add .txt files to {directory} and run this script again.")
        return

    items = []
    for txt_file in txt_files:
        try:
            text = read_text_file(txt_file)
            if text:
                # Chunk the text
                chunks = chunk_text(text)
                if chunks:
                    for i, chunk in enumerate(chunks):
                        items.append({
                            "text": chunk,
                            "source": f"kb/{txt_file.name}",
                        })
                    print(f"✓ Loaded: {txt_file.name} ({len(chunks)} chunks)")
                else:
                    print(f"⚠ Skipped (no chunks): {txt_file.name}")
            else:
                print(f"⚠ Skipped (empty): {txt_file.name}")
        except Exception as e:
            print(f"✗ Error reading {txt_file.name}: {e}")

    if not items:
        print("No content to seed.")
        return

    # Send to API
    upsert_url = f"{API_BASE}/upsert"
    data = json.dumps({"items": items}).encode("utf-8")
    req = request.Request(
        upsert_url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            result = json.loads(body)
            print(f"\n✓ Successfully seeded {result.get('upserted', 0)} chunks to knowledge base")
            print(f"  Total chunks created: {len(items)}")
    except request.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"✗ HTTP {e.code}: {error_body}")
        sys.exit(1)
    except Exception as e:
        print(f"✗ Failed to seed: {e}")
        print(f"  Make sure the backend is running at {API_BASE}")
        sys.exit(1)


if __name__ == "__main__":
    print("Seeding knowledge base from samples/ directory...\n")
    seed_from_directory()
    print("\nDone! You can now ask questions in the app.")

