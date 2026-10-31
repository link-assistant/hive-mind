#!/usr/bin/env python3
"""Check pinned SQLite descriptor borrowing and admission before initial PRAGMAs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import selectors
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
with tempfile.TemporaryDirectory(prefix="sqlite-native-handles-") as temporary:
    fixture = Path(temporary)
    binary = fixture / "probe"
    sqlite_object = fixture / "sqlite.o"
    subprocess.run(["cc", "-std=c11", "-w", "-O0", "-g0", "-pthread",
                    "-DSQLITE_ENABLE_FILESTAT", "-DSQLITE_THREADSAFE=1",
                    "-c", str(args.sqlite_source), "-o", str(sqlite_object)],
                   check=True, capture_output=True, timeout=30, preexec_fn=compiler_limits)
    subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O0", "-g0",
                    "-I", str(args.sqlite_source.parent),
                    str(Path(__file__).with_suffix(".c")), str(sqlite_object),
                    "-lm", "-ldl", "-pthread", "-o", str(binary)],
                   check=True, capture_output=True, timeout=30, preexec_fn=limits)
    for mode in ("initial", "retained"):
        for mutation in ("none", "directory", "database", "database-hardlink"):
            case = fixture / f"{mode}-{mutation}"
            case.mkdir(mode=0o700)
            selected = case / "selected"
            selected.mkdir(mode=0o700)
            child = subprocess.Popen([str(binary), str(selected), mode], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True, preexec_fn=limits)
            try:
                with selectors.DefaultSelector() as ready:
                    ready.register(child.stdout, selectors.EVENT_READ)
                    assert ready.select(timeout=5), "SQLite open did not finish"
                first = child.stdout.readline(1024)
                assert first.startswith("READY 3.51.3 "), first
                database = selected / "state.sqlite"
                if mutation == "directory":
                    selected.rename(case / "retired")
                    selected.mkdir(mode=0o700)
                elif mutation == "database":
                    database.rename(selected / "retired.sqlite")
                    database.touch(mode=0o600)
                elif mutation == "database-hardlink":
                    os.link(database, case / "outside.sqlite")
                output, error = child.communicate("\n", timeout=5)
                assert child.returncode == 0, (child.returncode, error[:4096])
                assert len(output) + len(error) <= 8192
                assert output.startswith("RESULT "), output
                fields = dict(item.split("=") for item in output.strip().split()[1:])
                assert int(fields["code"]) == (0 if mutation == "none" else 9), fields
                assert fields["ordinary"] == fields["sqliteOwnsClose"] == "1", fields
                print(json.dumps({"mode": mode, "mutation": mutation,
                                  "readiness": first.strip(), **fields}), flush=True)
            finally:
                if child.poll() is None:
                    child.kill()
                child.communicate(timeout=5)
