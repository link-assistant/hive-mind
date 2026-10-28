#!/usr/bin/env python3
"""Stream both complete incident parts; verify hashes and retain small excerpts."""
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "docs/case-studies/issue-3831/data"
MARKERS = (
    "Model capacity error detected. Retry",
    "Retry attempt:",
    "Model capacity error persisted:",
    "Completed items:",
    "Session ID:",
    "Codex CLI version:",
    "Creating recovery branch",
)

report = []
for source in json.loads((DATA / "incident-manifest.json").read_text()):
    digest = hashlib.sha256()
    lines = size = 0
    excerpts = []
    with gzip.open(DATA / source["file"], "rb") as stream:
        for lines, raw in enumerate(stream, 1):
            digest.update(raw)
            size += len(raw)
            text = raw.decode("utf-8", errors="replace").rstrip()
            # Nested command output can contain entire logs in a single line.
            if len(text) <= 1200 and any(marker in text for marker in MARKERS):
                excerpts.append({"line": lines, "text": text})
    assert size == source["originalBytes"], source["file"]
    assert digest.hexdigest() == source["sha256"], source["file"]
    report.append({**source, "lines": lines, "excerpts": excerpts})

destination = DATA / "incident-analysis.json"
destination.write_text(json.dumps(report, indent=2) + "\n")
for part in report:
    print(part["file"], part["lines"], "lines; SHA-256 verified")
    for excerpt in part["excerpts"]:
        print(f'  {excerpt["line"]}: {excerpt["text"]}')
