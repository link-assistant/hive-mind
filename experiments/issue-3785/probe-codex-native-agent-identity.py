#!/usr/bin/env python3
"""Pause actual native identity bootstrap while another writer changes auth.

Only disposable synthetic credentials and a finite loopback provider are used.
This exercises the CLI, its native registration client, and its actual writer.
"""
import argparse
import base64
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time

from native_process_group import stop_process_group
from native_network_fixture import background, environment, refuse_connect


def token(account, generation, owner=False):
    def part(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()

    claims = {"email": "synthetic@example.invalid", "https://api.openai.com/auth": {
        "chatgpt_account_id": account, "chatgpt_user_id": "synthetic-user",
        "chatgpt_plan_type": "plus"}}
    tokens = {"id_token": f"{part({'alg': 'none'})}.{part(claims)}.synthetic",
              "access_token": f"SYNTHETIC-ACCESS-{generation}",
              "refresh_token": f"SYNTHETIC-REFRESH-{generation}", "account_id": account}
    if owner:
        tokens["login_owner_id"] = owner if isinstance(owner, str) else "synthetic-login"
    return {"auth_mode": "chatgpt", "tokens": tokens,
            "last_refresh": datetime.now(timezone.utc).isoformat()}


def publish(file, value):
    pending = file.with_suffix(".next")
    pending.write_text(json.dumps(value))
    pending.chmod(0o600)
    pending.replace(file)


def run(binary, scenario, negative, diagnostic_file=None):
    entered = threading.Event()
    release = threading.Event()
    observed = []
    invalid = []
    registrations = []

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(3)

        def log_message(self, *_):
            pass

        def reply(self, status, value):
            data = json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)

        def do_CONNECT(self):
            refuse_connect(self, invalid)

        def do_POST(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                assert 0 < length <= 256 * 1024
                json.loads(self.rfile.read(length))
                if self.path == "/v1/agent/register":
                    generation = {"Bearer SYNTHETIC-ACCESS-G0": "G0", "Bearer SYNTHETIC-ACCESS-G1": "G1"}.get(
                        self.headers.get("Authorization"))
                    assert generation is not None
                    registrations.append(generation)
                    assert len(registrations) <= 3
                    if generation == "G1":
                        self.reply(400, {"error": "Synthetic replacement registration deliberately unavailable"})
                        return
                    if len(registrations) == 1:
                        assert generation == "G0"
                        entered.set()
                        assert release.wait(8), "Finite synthetic registration pause exceeded."
                    self.reply(200, {"agent_runtime_id": "synthetic-runtime"})
                elif self.path == "/v1/agent/synthetic-runtime/task/register":
                    self.reply(200, {"task_id": "synthetic-task"})
                elif self.path == "/v1/responses":
                    observed.append((self.headers.get("ChatGPT-Account-ID"),
                                     self.headers.get("Authorization", "").startswith("AgentAssertion ")))
                    assert len(observed) <= 2
                    self.reply(503, {"error": {"message": "Synthetic model unavailable", "code": "offline"}})
                elif not background(self):
                    raise AssertionError("Unexpected synthetic endpoint.")
            except (AssertionError, ValueError):
                invalid.append(("POST", self.path[:200]))
                self.reply(400, {})

        def do_GET(self):
            if self.path in ("/v1/models", "/v1/models?client_version=0.164.0"):
                self.reply(200, {"models": []})
            elif not background(self):
                invalid.append(("GET", self.path[:200]))
                self.reply(400, {})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.timeout = 3
    serving = threading.Thread(target=server.serve_forever)
    serving.start()
    child = None
    try:
        with tempfile.TemporaryDirectory(prefix="hive-3785-native-identity-") as directory:
            root = Path(directory)
            private = root / "private"
            canonical = root / "canonical"
            private.mkdir(mode=0o700)
            canonical.mkdir(mode=0o700)
            auth = canonical / "auth.json"
            initial = token("synthetic-account-A", "G0", scenario in ("owned-account-switch", "owned-fresh-login"))
            publish(auth, initial)
            config = f'''model = "synthetic-model"
model_provider = "offline"
chatgpt_base_url = "http://127.0.0.1:{server.server_port}/backend-api"
approval_policy = "never"
sandbox_mode = "read-only"
[features]
remote_plugin = false
apps = false
use_agent_identity = true
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
            (private / "config.toml").chmod(0o600)
            env = {**environment(server.server_port), "PATH": os.environ["PATH"], "HOME": str(private), "CODEX_HOME": str(private),
                   "CODEX_AUTH_HOME": str(canonical), "TOKIO_WORKER_THREADS": "2", "RUST_LOG": "off",
                   "CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL": f"http://127.0.0.1:{server.server_port}",
                   "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"}
            with tempfile.TemporaryFile() as diagnostics:
                child = subprocess.Popen(["prlimit", "--data=536870912", "--stack=16777216", "--core=0", "--",
                                          str(binary), "exec", "--skip-git-repo-check", "--json",
                                          "Synthetic identity request. Do not invoke tools."],
                                         cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=diagnostics,
                                         stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    started = time.monotonic()
                    while not entered.wait(0.05):
                        assert child.poll() is None, "Native CLI exited before the identity registration control."
                        assert time.monotonic() - started < 8, "Native CLI did not enter the bounded registration control."
                    if scenario == "account-switch" or scenario == "owned-account-switch":
                        replacement = token("synthetic-account-B", "G1", scenario == "owned-account-switch")
                        publish(auth, replacement)
                    elif scenario in ("legacy-fresh-owned-login", "owned-fresh-login"):
                        replacement = token("synthetic-account-A", "G1", "synthetic-new-login")
                        publish(auth, replacement)
                    elif scenario == "api-key-with-stale-tokens":
                        replacement = {**initial, "auth_mode": "apikey", "OPENAI_API_KEY": "SYNTHETIC-NEW-LOGIN"}
                        publish(auth, replacement)
                    elif scenario == "api-key-login":
                        replacement = {"OPENAI_API_KEY": "SYNTHETIC-NEW-LOGIN"}
                        publish(auth, replacement)
                    elif scenario == "rotation":
                        replacement = token("synthetic-account-A", "G1")
                        publish(auth, replacement)
                    elif scenario == "logout":
                        auth.unlink()
                        replacement = None
                    else:
                        replacement = initial
                    release.set()
                    while child.poll() is None:
                        assert time.monotonic() - started < 20, "Finite native identity experiment deadline exceeded."
                        assert os.fstat(diagnostics.fileno()).st_size <= 256 * 1024, "Finite native diagnostic limit exceeded."
                        time.sleep(0.05)
                finally:
                    release.set()
                    stop_process_group(child)
                    child = None
                    if diagnostic_file is not None:
                        diagnostics.seek(0)
                        diagnostic_file.write_bytes(diagnostics.read(256 * 1024))
                assert os.fstat(diagnostics.fileno()).st_size <= 256 * 1024
            assert invalid == [], f"Unexpected synthetic loopback endpoints: {invalid!r}."
            allowed = scenario in ("healthy", "rotation")
            bypass = negative and scenario in ("account-switch", "api-key-login", "api-key-with-stale-tokens", "legacy-fresh-owned-login")
            if allowed:
                assert observed == [("synthetic-account-A", True)], "The healthy native identity control must reach the model."
            if replacement is None:
                assert not auth.exists(), "Identity publication must not recreate logged-out credentials."
            else:
                final = json.loads(auth.read_text())
                identity = final.pop("agent_identity", None)
                if "tokens" in replacement:
                    if replacement.get("auth_mode") == "chatgpt":
                        assert final.pop("OPENAI_API_KEY", None) is None
                    final["last_refresh"] = datetime.fromisoformat(final["last_refresh"])
                    replacement["last_refresh"] = datetime.fromisoformat(replacement["last_refresh"])
                assert final == replacement, "Identity metadata must preserve the current credential generation."
                assert (identity is not None) == (allowed or bypass), \
                    "A stale identity must not be published into a replacement login."
                if identity is not None:
                    assert identity["account_id"] == "synthetic-account-A", "The control must identify the originating account."
            if not allowed and not bypass:
                assert ("synthetic-account-A", True) not in observed, "Native identity must not execute with the replaced account."
            assert not (private / "auth.json").exists(), "Native identity writing must not create private credential copies."
            print(f"PASS: {scenario}: " + ("reproduces stale native identity publication" if bypass else
                  "preserves canonical rotation" if allowed else "refuses stale identity publication")
                  + f"; model_requests={len(observed)}")
    finally:
        release.set()
        if child is not None:
            stop_process_group(child)
        server.shutdown()
        serving.join()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--expect-stale-publication", action="store_true")
    parser.add_argument("--diagnostics", type=Path)
    parser.add_argument("--scenario", choices=["healthy", "rotation", "account-switch", "api-key-login", "api-key-with-stale-tokens",
                                              "logout", "owned-account-switch", "legacy-fresh-owned-login", "owned-fresh-login"])
    args = parser.parse_args()
    assert args.binary.is_absolute() and args.binary.is_file()
    for case in ([args.scenario] if args.scenario else ["healthy", "rotation", "account-switch",
                                                      "api-key-login", "api-key-with-stale-tokens", "logout", "owned-account-switch", "legacy-fresh-owned-login", "owned-fresh-login"]):
        run(args.binary, case, args.expect_stale_publication, args.diagnostics)
