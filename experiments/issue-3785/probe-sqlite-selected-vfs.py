#!/usr/bin/env python3
"""Exercise the draft selected VFS against bounded, pinned-component fixtures."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import selectors
import subprocess
import tempfile


DATABASES = ("state_5.sqlite", "logs_2.sqlite", "goals_1.sqlite", "memories_1.sqlite",
             "memories_v2_1.sqlite", "queue_1.sqlite", "thread_history_1.sqlite")


def limits(data_mib=128):
    resource.setrlimit(resource.RLIMIT_DATA, (data_mib * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_STACK, (8 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def compiler_limits():
    limits(384)


def snapshot(directory):
    result = {}
    for path in directory.iterdir():
        if path.is_file():
            assert len(result) < 32 and path.stat().st_size <= 1024 * 1024
            result[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--sqlite-source", required=True, type=Path)
parser.add_argument("--all-databases", action="store_true")
parser.add_argument("--rebuild-only", action="store_true")
parser.add_argument("--expect-refused-rebuild", action="store_true",
                    help="Explicit negative control; never an acceptance gate")
args = parser.parse_args()
assert not args.expect_refused_rebuild or args.rebuild_only
assert args.sqlite_source.stat().st_size < 15 * 1024 * 1024
with args.sqlite_source.open("rb") as source:
    assert hashlib.file_digest(source, "sha256").hexdigest() == \
        "9512509b1bccb7461f79bea8aad6280ae4699e925fa4804381b71f59e7efb0c5"
with tempfile.TemporaryDirectory(prefix="sqlite-selected-vfs-") as temporary:
    fixture = Path(temporary)
    binary, sqlite_object = fixture / "probe", fixture / "sqlite.o"
    subprocess.run(["cc", "-std=c11", "-w", "-O0", "-g0", "-pthread",
                    "-DSQLITE_ENABLE_FILESTAT", "-DSQLITE_THREADSAFE=1",
                    "-c", str(args.sqlite_source), "-o", str(sqlite_object)],
                   check=True, capture_output=True, timeout=30, preexec_fn=compiler_limits)
    subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O0", "-g0",
                    "-I", str(args.sqlite_source.parent), "-DHIVE_CANONICAL_SQLITE_TEST=1",
                    str(Path(__file__).with_suffix(".c")),
                    str(Path(__file__).with_name("native-codex") / "canonical_sqlite_vfs.c"),
                    str(sqlite_object), "-lm", "-ldl", "-pthread", "-o", str(binary)],
                   check=True, capture_output=True, timeout=30, preexec_fn=limits)
    mutations = ("none", "directory", "database", "database-hardlink",
                 "directory-permissions", "database-permissions", "wal-hardlink", "shm-hardlink",
                 "directory-symlink", "ancestor-symlink", "database-symlink", "wal-replace", "shm-replace",
                 "wal-permissions", "shm-permissions")
    modes = ("initial", "query", "close-only", "transaction", "read-only", "reopen", "threads", "scratch")
    if args.rebuild_only:
        modes, mutations = ("rebuild",), ("none",)
    databases = DATABASES if args.all_databases else DATABASES[:1]
    for database_name in databases:
        for mode in modes:
            for mutation in mutations:
                if mode in ("initial", "read-only", "reopen") and mutation.startswith(("wal-", "shm-")):
                    continue
                case = fixture / f"{database_name}-{mode}-{mutation}"
                case.mkdir(mode=0o700)
                selected = case / "selected"
                selected.mkdir(mode=0o700)
                child = subprocess.Popen([str(binary), str(selected), database_name, mode],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE, text=True, preexec_fn=limits)
                try:
                    with selectors.DefaultSelector() as ready:
                        ready.register(child.stdout, selectors.EVENT_READ)
                        assert ready.select(timeout=5), "Selected SQLite did not become ready"
                    first = child.stdout.readline(1024)
                    if not first.startswith("READY 3.51.3"):
                        output, error = child.communicate(timeout=5)
                        raise AssertionError((database_name, mode, mutation, first, child.returncode, error[:4096]))
                    database = selected / database_name
                    observed = selected
                    retired_file = None
                    if mutation == "directory":
                        observed = case / "retired"
                        selected.rename(observed)
                        selected.mkdir(mode=0o700)
                    elif mutation == "database":
                        observed = case / "retired"
                        observed.mkdir(mode=0o700)
                        for path in tuple(selected.iterdir()):
                            path.rename(observed / path.name)
                        database.touch(mode=0o600)
                    elif mutation == "directory-symlink":
                        observed = case / "retired"
                        selected.rename(observed)
                        selected.symlink_to(observed, target_is_directory=True)
                    elif mutation == "ancestor-symlink":
                        retired_parent = fixture / (case.name + "-retired-parent")
                        case.rename(retired_parent)
                        case.symlink_to(retired_parent, target_is_directory=True)
                        observed = retired_parent / "selected"
                    elif mutation == "database-symlink":
                        retired_file = case / "retired-main"
                        database.rename(retired_file)
                        database.symlink_to(retired_file)
                    elif mutation in ("wal-replace", "shm-replace"):
                        source = Path(str(database) + ("-wal" if mutation.startswith("wal-") else "-shm"))
                        retired_file = case / "retired-journal"
                        source.rename(retired_file)
                        source.touch(mode=0o600)
                    elif mutation in ("wal-permissions", "shm-permissions"):
                        Path(str(database) + ("-wal" if mutation.startswith("wal-") else "-shm")).chmod(0o666)
                    elif mutation == "database-hardlink":
                        os.link(database, case / "outside.sqlite")
                    elif mutation == "directory-permissions":
                        selected.chmod(0o777)
                    elif mutation == "database-permissions":
                        database.chmod(0o666)
                    elif mutation == "wal-hardlink":
                        os.link(Path(str(database) + "-wal"), case / "outside-wal")
                    elif mutation == "shm-hardlink":
                        os.link(Path(str(database) + "-shm"), case / "outside-shm")
                    before = snapshot(observed)
                    retired_before = retired_file.read_bytes() if retired_file else None
                    output, error = child.communicate("\n", timeout=5)
                    assert len(output) + len(error) <= 8192
                    if args.expect_refused_rebuild:
                        assert child.returncode == 78 and error == "Canonical SQLite configuration is unavailable or unsafe.\n"
                        assert output == "" and (selected / "retired-main").is_file()
                        print(json.dumps({"mode": mode, "status": "reproduced-refused-rebuild"}), flush=True)
                        continue
                    unsafe = mutation != "none"
                    assert child.returncode == (78 if unsafe else 0), \
                        (database_name, mode, mutation, child.returncode, output, error[:4096])
                    if unsafe:
                        assert error == "Canonical SQLite configuration is unavailable or unsafe.\n", error
                        assert output == "" and snapshot(observed) == before, (mode, mutation)
                        if retired_file:
                            assert retired_file.stat().st_size <= 1024 * 1024
                            assert retired_file.read_bytes() == retired_before, (mode, mutation)
                    else:
                        assert output.startswith("RESULT selected=1 ordinary=1 nativeProgress=1 close=1"), output
                    print(json.dumps({"database": database_name, "mode": mode, "mutation": mutation,
                                      "status": "refused" if unsafe else "healthy",
                                      "unsafeFilesUnchanged": unsafe and snapshot(observed) == before}), flush=True)
                finally:
                    if child.poll() is None:
                        child.kill()
                    child.communicate(timeout=5)

    # Two real processes overlap their SQLite connections and write 100 bounded
    # rows through the same selected WAL, while three threads above exercise
    # descriptor registry ownership within a process.
    concurrent = fixture / "concurrent"
    concurrent.mkdir(mode=0o700)
    peers = []
    try:
        for _ in range(0 if args.rebuild_only else 2):
            child = subprocess.Popen([str(binary), str(concurrent), DATABASES[0], "concurrent"],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, preexec_fn=limits)
            peers.append(child)
            with selectors.DefaultSelector() as ready:
                ready.register(child.stdout, selectors.EVENT_READ)
                assert ready.select(timeout=5), "Concurrent SQLite did not become ready"
            first = child.stdout.readline(1024)
            if not first.startswith("READY 3.51.3"):
                output, error = child.communicate(timeout=5)
                raise AssertionError((first, child.returncode, error[:4096]))
        for child in peers:
            child.stdin.write("\n")
            child.stdin.flush()
        for child in peers:
            output, error = child.communicate(timeout=10)
            assert len(output) + len(error) <= 8192
            assert child.returncode == 0 and output.startswith("RESULT selected=1"), (output, error)
        if peers:
            import sqlite3
            with sqlite3.connect(concurrent / DATABASES[0]) as observer:
                assert observer.execute("SELECT COUNT(*) FROM synthetic").fetchone()[0] == 104
            print(json.dumps({"concurrentProcesses": 2, "rows": 104, "status": "healthy"}), flush=True)
    finally:
        for child in peers:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=5)
