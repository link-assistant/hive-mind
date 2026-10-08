"""Archive completed implementation CI runs without changing downloaded log bytes."""

import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "docs/case-studies/issue-2685/data"
SHA = "c21ccd1d97fd321ba539e1c3841cf7dab8595d50"
RUNS = (("release", 37719356959), ("security", 37719356693), ("links", 37719356610))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--sha", default=SHA)
parser.add_argument("--run", action="append", help="Workflow name and run ID, e.g. release:37733486083")
parser.add_argument("--output", default="ci-code-validation.json")
args = parser.parse_args()
SHA = args.sha
if args.run:
    RUNS = tuple((name, int(run_id)) for name, run_id in (entry.split(":", 1) for entry in args.run))
records = []
for name, run_id in RUNS:
    metadata = f"ci-logs/{name}-{run_id}.json" if args.run else f"ci-logs/{name}-final-code.json"
    record = json.loads((ROOT / metadata).read_text())
    assert record["headSha"] == SHA
    assert record["status"] == "completed" and record["conclusion"] == "success"
    assert all(job["conclusion"] in ("success", "skipped") for job in record["jobs"])
    raw = (ROOT / f"ci-logs/{name}-{run_id}.log").read_bytes()
    archive = DEST / f"ci-{name}-{run_id}.log.gz"
    archive.write_bytes(gzip.compress(raw, mtime=0))
    assert gzip.decompress(archive.read_bytes()) == raw
    records.append({
        "workflow": name,
        "run_id": run_id,
        "url": f"https://github.com/link-assistant/hive-mind/actions/runs/{run_id}",
        **record,
        "log": {
            "archive": archive.name,
            "decoded_bytes": len(raw),
            "decoded_lines": len(raw.splitlines()),
            "decoded_sha256": hashlib.sha256(raw).hexdigest(),
        },
    })
result = {"recorded_at": datetime.now(timezone.utc).isoformat(), "implementation_sha": SHA, "runs": records}
(DEST / args.output).write_text(json.dumps(result, indent=2) + "\n")
print(f"Archived {len(records)} successful CI runs for {SHA}")
