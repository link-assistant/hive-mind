#!/usr/bin/env python3
"""Bounded system-SQLite VFS design control; no native admission claim."""
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


def snapshot(directory):
    result = {}
    for suffix in ("", "-wal", "-shm"):
        path = directory / f"state.sqlite{suffix}"
        if path.exists():
            assert path.stat().st_size <= 1024 * 1024
            result[suffix] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--sqlite-source", type=Path,
                    help="Checked libsqlite3-sys 0.37.0 sqlite3.c instead of the system library")
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix="sqlite-vfs-close-") as temporary:
    fixture = Path(temporary)
    binary = fixture / "probe"
    compile_args = [
        "cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O0", "-g0",
        str(Path(__file__).with_suffix(".c")), "-lsqlite3", "-o", str(binary),
    ]
    if args.sqlite_source:
        assert args.sqlite_source.stat().st_size < 15 * 1024 * 1024
        with args.sqlite_source.open("rb") as stream:
            assert hashlib.file_digest(stream, "sha256").hexdigest() == \
                "9512509b1bccb7461f79bea8aad6280ae4699e925fa4804381b71f59e7efb0c5"
        # Compile the amalgamation separately so strict warnings still apply to
        # this fixture without imposing them on the pinned upstream source.
        sqlite_object = fixture / "sqlite.o"
        flags = ["SQLITE_CORE", "SQLITE_DEFAULT_FOREIGN_KEYS=1", "SQLITE_ENABLE_API_ARMOR",
                 "SQLITE_ENABLE_COLUMN_METADATA", "SQLITE_ENABLE_DBSTAT_VTAB",
                 "SQLITE_ENABLE_FTS3", "SQLITE_ENABLE_FTS3_PARENTHESIS", "SQLITE_ENABLE_FTS5",
                 "SQLITE_ENABLE_JSON1", "SQLITE_ENABLE_LOAD_EXTENSION=1",
                 "SQLITE_ENABLE_MEMORY_MANAGEMENT", "SQLITE_ENABLE_RTREE", "SQLITE_ENABLE_STAT4",
                 "SQLITE_SOUNDEX", "SQLITE_THREADSAFE=1", "SQLITE_USE_URI", "HAVE_USLEEP=1",
                 "HAVE_ISNAN", "_POSIX_THREAD_SAFE_FUNCTIONS", "_DEFAULT_SOURCE"]
        subprocess.run(["cc", "-std=c11", "-w", "-O0", "-g0", "-pthread",
                        *[f"-D{flag}" for flag in flags], "-c", str(args.sqlite_source),
                        "-o", str(sqlite_object)], check=True, capture_output=True,
                       timeout=30, preexec_fn=compiler_limits)
        compile_args = ["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O0", "-g0",
                        "-I", str(args.sqlite_source.parent), str(Path(__file__).with_suffix(".c")),
                        str(sqlite_object), "-lm", "-ldl", "-pthread", "-o", str(binary)]
    subprocess.run(compile_args, check=True, capture_output=True, timeout=30, preexec_fn=limits)
    mutations = ("none", "directory", "database", "database-hardlink", "directory-permissions", "database-permissions")
    cases = [(mutation, mode) for mutation in mutations for mode in ("query", "close-only")]
    for mutation, mode in cases:
        case = fixture / f"{mutation}-{mode}"
        case.mkdir(mode=0o700)
        selected = case / "selected"
        selected.mkdir(mode=0o700)
        child = subprocess.Popen([str(binary), str(selected), mode], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, preexec_fn=limits)
        try:
            with selectors.DefaultSelector() as ready:
                ready.register(child.stdout, selectors.EVENT_READ)
                assert ready.select(timeout=5), "SQLite setup did not become ready"
            first = child.stdout.readline(1024)
            assert first.startswith("READY "), first
            database = selected / "state.sqlite"
            observed = selected
            if mutation == "directory":
                observed = case / "retired"
                selected.rename(observed)
                selected.mkdir(mode=0o700)
            elif mutation == "database":
                observed = case / "retired"
                observed.mkdir(mode=0o700)
                for suffix in ("", "-wal", "-shm"):
                    source = Path(str(database) + suffix)
                    if source.exists():
                        source.rename(observed / source.name)
                database.touch(mode=0o600)
            elif mutation == "database-hardlink":
                os.link(database, case / "outside.sqlite")
            elif mutation == "directory-permissions":
                selected.chmod(0o777)
            elif mutation == "database-permissions":
                database.chmod(0o666)
            before = snapshot(observed)
            output, error = child.communicate("\n", timeout=5)
            assert child.returncode == 0, (child.returncode, error[:4096])
            assert len(output) + len(error) <= 8192
            assert output.startswith("RESULT "), output
            fields = dict(item.split("=") for item in output.strip().split()[1:])
            unsafe = mutation != "none"
            assert bool(int(fields["refused"])) == unsafe, fields
            if mode == "query":
                assert (int(fields["query"]) != 0) == unsafe, fields
                assert (int(fields["write"]) != 0) == unsafe, fields
            else:
                assert fields["query"] == fields["write"] == "-1", fields
            assert int(fields["close"]) == 0, fields
            after = snapshot(observed)
            if unsafe:
                assert after == before, (mutation, before, after)
                assert int(fields["blocked"]) > 0, fields
            print(json.dumps({"sqliteVersion": first.strip().split()[1],
                              "mutation": mutation, "mode": mode,
                              "unsafeFilesUnchanged": after == before,
                              **fields}), flush=True)
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=5)
