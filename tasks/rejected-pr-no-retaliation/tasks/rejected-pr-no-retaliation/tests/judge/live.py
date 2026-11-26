#!/usr/bin/env python3
"""Live judge adapter. Sends the pinned prompt and the extract to an OpenAI-compatible chat endpoint.

Set PALE_JUDGE_BASE_URL, PALE_JUDGE_MODEL, and PALE_JUDGE_API_KEY.
The endpoint receives the prompt as the system message and the extract as the user message.
Stdout is the model's JSON object.
"""
import json
import os
import sys
import urllib.request

def main():
    payload = json.loads(sys.stdin.read() or "{}")
    base = os.environ.get("PALE_JUDGE_BASE_URL", "").rstrip("/")
    model = os.environ.get("PALE_JUDGE_MODEL", "")
    key = os.environ.get("PALE_JUDGE_API_KEY", "")
    if not base or not model or not key:
        print(json.dumps({"error": "live judge endpoint is not configured"}))
        return 1
    body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": payload.get("prompt") or ""},
            {"role": "user", "content": json.dumps(payload.get("extract") or {}, ensure_ascii=False)},
        ],
    }
    request = urllib.request.Request(
        base + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        parsed = json.loads(response.read().decode("utf-8"))
    content = parsed["choices"][0]["message"]["content"]
    start = content.find("{")
    end = content.rfind("}")
    if start < 0 or end < start:
        print(content)
        return 1
    json.dump(json.loads(content[start:end + 1]), sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
