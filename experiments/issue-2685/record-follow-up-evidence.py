"""Preserve review evidence after all local validation commands have completed."""

import gzip
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path("/tmp/issue-2685-review")
DEST = ROOT / "docs/case-studies/issue-2685/data"

suite = (SOURCE / "default-suite.log").read_text()
assert re.search(r"All 578 selected test file\(s\) passed\.", suite), "Wait for the complete default suite"
assert "ℹ tests 37" in (SOURCE / "focused-final.log").read_text()
assert "ℹ fail 0" in (SOURCE / "focused-final.log").read_text()

commands = {
    "parent-pr-before": ("node --test tests/github-parent-pr-2685.test.mjs (before the fix)", 1),
    "rest-before": ("node --test --test-name-pattern=parent-prs-rest tests/hive-outcomes-2685.test.mjs (before correcting REST pagination)", 1),
    "rest-invalid-cli": ("gh api repos/link-assistant/calculator/issues/230/timeline --paginate --slurp --jq '.' (expected CLI rejection)", 1),
    "focused-final": ("node --test tests/github-parent-pr-2685.test.mjs tests/hive-outcomes-2685.test.mjs", 0),
    "default-suite": ("npm test -- --continue-on-failure", 0),
    "github-integration": ("node scripts/run-tests.mjs --suite github-integration", 0),
    "lint-final": ("npm run lint", 0),
    "format": ("npm run format:check", 0),
    "duplication": ("npm run check:duplication", 0),
    "secrets": ("npm run check:secrets", 0),
    "syntax": ("bash scripts/check-mjs-syntax.sh", 0),
    "line-limits": ("bash scripts/check-file-line-limits.sh", 0),
    "freshness": ("node scripts/check-dependency-freshness.mjs", 0),
    "docs-validation": ("node tests/docs-validation.mjs", 0),
    "docs-language": ("node tests/test-docs-language-sync.mjs", 0),
    "package-manager": ("node scripts/check-package-manager.mjs", 0),
    "version": ("node scripts/check-version.mjs", 0),
    "changeset": ("node scripts/validate-changeset.mjs", 0),
    "auto-continue": ("node tests/solve-auto-continue-detection-1895.test.mjs", 0),
    "relations": ("node --test tests/hive-issue-relations-2615.test.mjs", 0),
    "draft-prs": ("node tests/test-issue-1760-draft-linked-prs.mjs", 0),
    "solution-reporting": ("node tests/solution-draft-listing-2160.test.mjs", 0),
    "live-lookup": ("node experiments/issue-2685/verify-parent-pr-lookup.mjs", 0),
    "hive-help": ("./src/hive.mjs --help", 0),
    "hive-version": ("./src/hive.mjs --version", 0),
}


def archive(source, name):
    raw = source.read_bytes()
    target = DEST / name
    if name.endswith(".gz"):
        target.write_bytes(gzip.compress(raw, mtime=0))
        assert gzip.decompress(target.read_bytes()) == raw
    else:
        target.write_bytes(raw)
    return {
        "archive": name,
        "decoded_bytes": len(raw),
        "decoded_lines": len(raw.splitlines()),
        "decoded_sha256": hashlib.sha256(raw).hexdigest(),
    }


records = []
for name, (command, exit_code) in commands.items():
    target = "parent-pr-before.log" if name == "parent-pr-before" else f"follow-up-{name}.log.gz"
    records.append({"command": command, "exit_code": exit_code, **archive(SOURCE / f"{name}.log", target)})

session = archive(SOURCE / "previous-successful-session.log", "previous-successful-session.log.gz")
session["source"] = "https://gist.github.com/konard/89660cd6f530afcd6234fb1169db5ec8"
shutil.copyfile("/tmp/feedback-lines-cleanup.json", DEST / "follow-up-integration-cleanup.json")
integration_details = archive(Path("/tmp/feedback-lines-integration.log"), "follow-up-integration-details.log.gz")
intermediate_logs = [
    archive(path, f"follow-up-intermediate-{path.name}.gz")
    for path in sorted(SOURCE.glob("*.log"))
    if path.stem not in commands and path.name != "previous-successful-session.log"
]
result = {
    "recorded_at": datetime.now(timezone.utc).isoformat(),
    "base_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "node": subprocess.check_output(["node", "--version"], text=True).strip(),
    "default_test_files": 578,
    "focused_tests": 37,
    "checks": records,
    "previous_successful_session": session,
    "integration_details": integration_details,
    "integration_cleanup": "follow-up-integration-cleanup.json",
    "intermediate_logs": intermediate_logs,
}
(DEST / "follow-up-evidence.json").write_text(json.dumps(result, indent=2) + "\n")
print(f"Archived {len(records)} check logs, the previous session, and integration evidence")
