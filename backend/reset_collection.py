#!/usr/bin/env python3
"""Reset Qdrant collection - deletes and recreates it fresh."""
import os
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "kb_documents")
OPENAI_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")

EMBED_DIMS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
}
VECTOR_SIZE = EMBED_DIMS.get(OPENAI_EMBED_MODEL, 1536)

client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=60)

print(f"Resetting collection: {QDRANT_COLLECTION}")

# Delete if exists
try:
    client.delete_collection(QDRANT_COLLECTION)
    print(f"✓ Deleted existing collection")
except Exception as e:
    print(f"  Collection didn't exist (that's ok)")

# Recreate
client.recreate_collection(
    collection_name=QDRANT_COLLECTION,
    vectors_config=qmodels.VectorParams(
        size=VECTOR_SIZE,
        distance=qmodels.Distance.COSINE,
    ),
)

print(f"✓ Created fresh collection")
print(f"\nNow run: python seed_kb.py")


