#!/usr/bin/env python3
"""Require selected native exec to refuse an unusable SQLite migration schema."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import threading
import time

from native_network_fixture import background, environment, refuse_connect
from native_process_group import stop_process_group


def run(binary, root, unsafe, selected, expected_fallback, diagnostics):
    observed, invalid = [], []

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(3)

        def log_message(self, *_):
            pass

        def do_CONNECT(self):
            refuse_connect(self, invalid)

        def do_GET(self):
            if background(self):
                return
            if self.path not in ("/v1/models", "/v1/models?client_version=0.164.0"):
                invalid.append(True)
                self.send_error(400)
                return
            self.reply(200, b'{"models":[]}')

        def do_POST(self):
            if background(self):
                return
            length = int(self.headers.get("Content-Length", "0"))
            if self.path != "/v1/responses" or not 0 < length <= 256 * 1024:
                invalid.append(True)
                self.send_error(400)
                return
            self.rfile.read(length)
            observed.append(self.headers.get("Authorization") == "Bearer sk-SYNTHETIC-SQLITE")
            self.reply(503, b'{"error":{"message":"Synthetic offline model","code":"offline"}}')

        def reply(self, status, data):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)

    private, canonical, auth = (root / name for name in ("configuration", "canonical", "auth"))
    for directory in (private, canonical, auth):
        directory.mkdir(mode=0o700)
    for entry in ("sessions", "archived_sessions", "thread-writer-locks"):
        (canonical / entry).mkdir(mode=0o700)
    (canonical / "rollout-maintenance.lock").touch(mode=0o600)
    (auth / "auth.json").write_text('{"OPENAI_API_KEY":"sk-SYNTHETIC-SQLITE"}\n')
    (auth / "auth.json").chmod(0o600)
    database = canonical / "state_5.sqlite"
    if unsafe:
        with sqlite3.connect(database) as connection:
            connection.execute("CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY)")
        database.chmod(0o600)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    config = f'''model = "synthetic-model"
model_provider = "offline"
chatgpt_base_url = "http://127.0.0.1:{server.server_port}/backend-api"
approval_policy = "never"
sandbox_mode = "read-only"
[analytics]
enabled = false
[features]
remote_plugin = false
plugins = false
apps = false
[model_providers.offline]
name = "Offline"
base_url = "http://127.0.0.1:{server.server_port}/v1"
model_catalog_url = "http://127.0.0.1:{server.server_port}/v1/models"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 0
stream_max_retries = 0
'''
    (private / "config.toml").write_text(config)
    env = {**environment(server.server_port), "PATH": os.environ["PATH"],
           "HOME": str(private), "CODEX_HOME": str(private), "CODEX_AUTH_HOME": str(auth),
           "CODEX_SQLITE_HOME": str(canonical), "CODEX_SESSION_INDEX_HOME": str(canonical),
           "CODEX_ROLLOUT_MAINTENANCE_HOME": str(canonical), "TOKIO_WORKER_THREADS": "2",
           "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1",
           "RUST_LOG": "codex_rollout::state_db=warn,codex_state=warn"}
    if selected:
        env["CODEX_ROLLOUT_HOME"] = str(canonical)
    if diagnostics:
        env["RUST_LOG"] = "codex_rollout::state_db=debug,codex_state=debug"
    child = None
    try:
        with tempfile.TemporaryFile() as output:
            child = subprocess.Popen([
                "prlimit", "--data=536870912", "--stack=16777216", "--core=0", "--",
                str(binary), "--no-daemon", "exec", "--skip-git-repo-check", "--json",
                "Synthetic SQLite startup check. Do not invoke tools.",
            ], cwd=root, env=env, stdin=subprocess.DEVNULL,
                stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            deadline = time.monotonic() + 15
            while child.poll() is None and time.monotonic() < deadline:
                assert os.fstat(output.fileno()).st_size <= 256 * 1024
                time.sleep(0.02)
            assert os.fstat(output.fileno()).st_size <= 256 * 1024
            output.seek(0)
            diagnostic = output.read(256 * 1024 + 1)
            assert len(diagnostic) <= 256 * 1024
            if diagnostics:
                destination = diagnostics / f"native-sqlite-startup-{unsafe}.log"
                with destination.open("xb") as stream:
                    stream.write(diagnostic)
                destination.chmod(0o600)
            assert child.poll() is not None, "The native SQLite startup fixture must terminate."
    finally:
        if child is not None:
            stop_process_group(child)
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive()
    assert not invalid and all(observed), "Native traffic must use only the synthetic provider and account."
    expected = 0 if unsafe and selected and not expected_fallback else 1
    if unsafe and (expected_fallback or not selected):
        assert b"no such column: checksum" in diagnostic, "The fixture must reproduce native migration failure."
    print(json.dumps({"selected": selected, "unusableMigrationSchema": unsafe,
                      "modelRequests": len(observed), "exit": child.returncode,
                      "migrationFailureDiagnostic": b"no such column" in diagnostic}), flush=True)
    assert len(observed) == expected, "Unusable selected native SQLite must refuse before a model request."
    if unsafe and selected and not expected_fallback:
        assert child.returncode != 0
        assert b"Canonical SQLite" in diagnostic, "Selected storage refusal must be explicit."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--expect-fallback", action="store_true")
    parser.add_argument("--without-path-selector", action="store_true")
    parser.add_argument("--diagnostics", type=Path)
    args = parser.parse_args()
    assert args.binary.is_absolute() and args.binary.is_file()
    if args.diagnostics:
        args.diagnostics.mkdir(mode=0o700)
    with args.binary.open("rb") as source:
        print(json.dumps({"binarySha256": hashlib.file_digest(source, "sha256").hexdigest()}), flush=True)
    with tempfile.TemporaryDirectory(prefix="hive-native-sqlite-startup-") as temporary:
        for unsafe in (False, True):
            root = Path(temporary) / str(unsafe)
            root.mkdir(mode=0o700)
            run(args.binary, root, unsafe, not args.without_path_selector,
                args.expect_fallback, args.diagnostics)


if __name__ == "__main__":
    main()
