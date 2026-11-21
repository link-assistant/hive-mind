#!/usr/bin/env python3
"""Bound a progress-hook design probe; this is not native Codex acceptance."""
import hashlib
import json
import os
from pathlib import Path
import resource
import sqlite3
import tempfile

resource.setrlimit(resource.RLIMIT_DATA, (128 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_STACK, (8 * 1024 * 1024,) * 2)
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def digest(path):
    assert path.stat().st_size <= 1024 * 1024
    return hashlib.sha256(path.read_bytes()).hexdigest()


for mutation in ("none", "directory", "database", "database-hardlink", "directory-permissions", "database-permissions"):
    with tempfile.TemporaryDirectory(prefix="sqlite-progress-close-") as temporary:
        root = Path(temporary)
        selected = root / "selected"
        selected.mkdir(mode=0o700)
        database = selected / "state.sqlite"
        connection = sqlite3.connect(database, timeout=1)
        assert connection.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
        connection.execute("PRAGMA wal_autocheckpoint=0")
        connection.execute("CREATE TABLE synthetic (value TEXT)")
        connection.execute("INSERT INTO synthetic VALUES ('bounded synthetic data')")
        connection.commit()
        directory_identity = selected.stat().st_dev, selected.stat().st_ino
        database_identity = database.stat().st_dev, database.stat().st_ino
        calls = 0

        def progress():
            global calls
            calls += 1
            assert calls <= 1000
            try:
                directory_info, database_info = selected.stat(), database.stat()
                return int((directory_info.st_dev, directory_info.st_ino) != directory_identity
                           or (database_info.st_dev, database_info.st_ino) != database_identity
                           or directory_info.st_mode & 0o077 != 0
                           or database_info.st_mode & 0o022 != 0
                           or database_info.st_nlink != 1)
            except FileNotFoundError:
                return 1

        connection.set_progress_handler(progress, 1)
        if mutation == "directory":
            retired = root / "retired"
            selected.rename(retired)
            selected.mkdir(mode=0o700)
            retired_database = retired / database.name
        elif mutation == "database":
            retired_database = selected / "retired.sqlite"
            for suffix in ("", "-wal", "-shm"):
                source = Path(str(database) + suffix)
                if source.exists():
                    source.rename(Path(str(retired_database) + suffix))
            database.touch(mode=0o600)
        else:
            retired_database = database
            if mutation == "database-hardlink":
                os.link(database, root / "outside.sqlite")
            elif mutation == "directory-permissions":
                selected.chmod(0o777)
            elif mutation == "database-permissions":
                database.chmod(0o666)
        before = digest(retired_database)
        refused = False
        try:
            connection.execute("SELECT * FROM synthetic").fetchall()
        except sqlite3.OperationalError as error:
            assert str(error) == "interrupted"
            refused = True
        assert refused == (mutation != "none")
        query_calls = calls
        connection.close()
        print(json.dumps({
            "sqliteVersion": sqlite3.sqlite_version,
            "mutation": mutation,
            "queryRefused": refused,
            "queryHookCalls": query_calls,
            "closeHookCalls": calls - query_calls,
            "retiredMainFileChangedOnClose": digest(retired_database) != before,
        }), flush=True)
