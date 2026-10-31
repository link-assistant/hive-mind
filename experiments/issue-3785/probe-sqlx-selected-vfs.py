#!/usr/bin/env python3
"""Probe real SQLx pools with the draft adapter, independently of the native CLI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import selectors
import subprocess
import tempfile


def limits():
    resource.setrlimit(resource.RLIMIT_DATA, (256 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_STACK, (16 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def snapshot(directory):
    result = {}
    for path in directory.iterdir():
        if path.is_file():
            assert len(result) < 32 and path.stat().st_size <= 1024 * 1024
            result[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("binary", type=Path)
args = parser.parse_args()
binary = args.binary.resolve(strict=True)
mutations = ("none", "directory", "database", "database-hardlink", "directory-permissions",
             "database-permissions", "wal-hardlink", "shm-hardlink", "wal-replace", "shm-replace")
with tempfile.TemporaryDirectory(prefix="sqlx-selected-vfs-") as temporary:
    fixture = Path(temporary)
    for mode in ("query", "close-only"):
        for mutation in mutations:
            case = fixture / f"{mode}-{mutation}"
            case.mkdir(mode=0o700)
            selected = case / "selected"
            selected.mkdir(mode=0o700)
            environment = dict(os.environ, CODEX_ROLLOUT_HOME=str(selected), CODEX_SQLITE_HOME=str(selected))
            environment.pop("HIVE_CODEX_SQLITE_TRACE", None)
            child = subprocess.Popen([str(binary), str(selected), mode], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                     env=environment, preexec_fn=limits)
            try:
                with selectors.DefaultSelector() as ready:
                    ready.register(child.stdout, selectors.EVENT_READ)
                    assert ready.select(timeout=8), "Real SQLx pool did not become ready"
                first = child.stdout.readline(1024)
                if first != "READY actualSqlx=0.9.0 sqlite=3051003\n":
                    output, error = child.communicate(timeout=5)
                    raise AssertionError((mode, mutation, first, child.returncode, error[:4096]))
                database = selected / "state_5.sqlite"
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
                elif mutation in ("wal-replace", "shm-replace"):
                    source = Path(str(database) + ("-wal" if mutation.startswith("wal-") else "-shm"))
                    retired_file = case / "retired-journal"
                    source.rename(retired_file)
                    source.touch(mode=0o600)
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
                output, error = child.communicate("\n", timeout=8)
                assert len(output) + len(error) <= 8192
                unsafe = mutation != "none"
                assert child.returncode == (78 if unsafe else 0), (mode, mutation, child.returncode, output, error)
                if unsafe:
                    assert error == "Canonical SQLite configuration is unavailable or unsafe.\n", error
                    assert output == "" and snapshot(observed) == before, (mode, mutation)
                    if retired_file:
                        assert retired_file.read_bytes() == retired_before, (mode, mutation)
                else:
                    assert output == "RESULT actualSqlx=1 ordinary=1 nativeDeadlineHandler=1 close=1\n", output
                print(json.dumps({"actualSqlx": "0.9.0", "sqlite": "3.51.3", "mode": mode,
                                  "mutation": mutation, "status": "refused" if unsafe else "healthy",
                                  "unsafeFilesUnchanged": unsafe and snapshot(observed) == before}), flush=True)
            finally:
                if child.poll() is None:
                    child.kill()
                child.communicate(timeout=5)
