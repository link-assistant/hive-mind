"""Read complete production evidence in finite chunks and preserve line-numbered events."""
import gzip
import hashlib
import json
from pathlib import Path

data = Path(__file__).resolve().parents[2] / "docs/case-studies/issue-2685/data"
patterns = ["🔗 Repaired 18", "removed 18 lines", "Monitoring iteration 1", "Found 19", "Skipped 19", "All issues processed!", "Exit Code:", "Codex CLI connection validated", "FIXTURE_SOLVER_STARTED"]
results = {}
for name in ["first-run.log", "restarted-run.log", "calculator-pr-228-first-session.log", "calculator-pr-228-restart.log"]:
    path = data / name
    packed = path.with_suffix(".log.gz")
    content = path.read_bytes() if path.exists() else gzip.decompress(packed.read_bytes())
    digest = hashlib.sha256(content).hexdigest()
    lines = content.decode().splitlines()
    events = []
    for start in range(0, len(lines), 1500):
        chunk = lines[start:start + 1500]
        for offset, line in enumerate(chunk, start + 1):
            if any(pattern in line for pattern in patterns):
                # Large tool-result JSON may contain an entire other log: preserve a bounded context.
                match = next(pattern for pattern in patterns if pattern in line)
                at = line.index(match)
                events.append({"line": offset, "text": line[max(0, at - 65):at + 260]})
    results[name] = {"bytes": len(content), "lines": len(lines), "sha256": digest, "chunks_of_at_most_1500_lines": (len(lines) + 1499) // 1500, "events": events}
(data / "evidence-analysis.json").write_text(json.dumps(results, indent=2) + "\n")
for name, result in results.items():
    print(name, result["lines"], "lines", len(result["events"]), "events", result["sha256"])
