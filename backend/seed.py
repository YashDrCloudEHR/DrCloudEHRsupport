import json
import os
import sys
from urllib import request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
SAMPLES_DIR = os.path.join(ROOT, "samples")


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()


def main():
    api_base = os.environ.get("API_BASE", "http://localhost:8000")
    upsert_url = f"{api_base}/upsert"

    items = [
        {
            "text": read(os.path.join(SAMPLES_DIR, "qdrant.txt")),
            "source": "samples/qdrant",
        },
        {
            "text": read(os.path.join(SAMPLES_DIR, "embeddings.txt")),
            "source": "samples/embeddings",
        },
    ]

    data = json.dumps({"items": items}).encode("utf-8")
    req = request.Request(upsert_url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            print(f"Status: {resp.status}")
            print(body)
    except Exception as e:
        print(f"Failed to seed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()


