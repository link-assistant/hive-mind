#!/usr/bin/env python3
"""Compare finite healthy operations against the same checked SQLite component."""
import argparse
import hashlib
import json
from pathlib import Path
import resource
import subprocess
import tempfile


def limits(data_mib=128):
    resource.setrlimit(resource.RLIMIT_DATA, (data_mib * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_STACK, (8 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def compiler_limits():
    limits(384)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--sqlite-source", required=True, type=Path)
args = parser.parse_args()
assert args.sqlite_source.stat().st_size < 15 * 1024 * 1024
with args.sqlite_source.open("rb") as source:
    assert hashlib.file_digest(source, "sha256").hexdigest() == \
        "9512509b1bccb7461f79bea8aad6280ae4699e925fa4804381b71f59e7efb0c5"
with tempfile.TemporaryDirectory(prefix="sqlite-selected-benchmark-") as temporary:
    root = Path(temporary)
    binary, sqlite_object = root / "probe", root / "sqlite.o"
    subprocess.run(["cc", "-std=c11", "-w", "-O0", "-g0", "-pthread",
                    "-DSQLITE_ENABLE_FILESTAT", "-DSQLITE_THREADSAFE=1",
                    "-c", str(args.sqlite_source), "-o", str(sqlite_object)],
                   check=True, timeout=30, preexec_fn=compiler_limits)
    subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-g0",
                    "-D_FORTIFY_SOURCE=2",
                    "-I", str(args.sqlite_source.parent),
                    str(Path(__file__).with_suffix(".c")),
                    str(Path(__file__).with_name("native-codex") / "canonical_sqlite_vfs.c"),
                    str(sqlite_object), "-lm", "-ldl", "-pthread", "-o", str(binary)],
                   check=True, timeout=30, preexec_fn=limits)
    for repetition in range(3):
        modes = ("ordinary", "selected") if repetition % 2 == 0 else ("selected", "ordinary")
        for mode in modes:
            selected = root / f"{mode}-{repetition}"
            selected.mkdir(mode=0o700)
            result = subprocess.run([str(binary), str(selected), mode], capture_output=True,
                                    text=True, timeout=10, preexec_fn=limits)
            assert result.returncode == 0 and len(result.stdout) + len(result.stderr) <= 8192, result.stderr
            record = json.loads(result.stdout)
            assert record["mode"] == mode and record["queries"] == 1000 and record["writes"] == 100
            print(json.dumps({"sqlite": "3.51.3", "repetition": repetition, **record}), flush=True)
