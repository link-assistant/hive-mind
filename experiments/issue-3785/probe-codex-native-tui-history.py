#!/usr/bin/env python3
"""Bounded real native TUI prompt-history admission probe; synthetic state only."""
import argparse
import errno
import fcntl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import pty
import select
import struct
import subprocess
import tempfile
import termios
import threading
import time

from native_process_group import stop_process_group
from native_network_fixture import background, environment, refuse_connect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("binary", type=Path)
parser.add_argument("--expect-unsafe-execution", action="store_true")
parser.add_argument("--expect-private-history", action="store_true")
parser.add_argument("--without-selector", action="store_true")
parser.add_argument("--diagnostics", type=Path)
args = parser.parse_args()
assert args.binary.is_absolute() and args.binary.is_file()
observed = []
invalid = []


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(3)

    def log_message(self, *_):
        pass

    def do_CONNECT(self):
        refuse_connect(self, invalid)

    def do_POST(self):
        if background(self):
            return
        length = int(self.headers.get("Content-Length", "0"))
        if self.path != "/v1/responses" or not 0 < length <= 256 * 1024:
            invalid.append(True)
            self.send_error(400)
            return
        self.rfile.read(length)
        observed.append("G0" if self.headers.get("Authorization") == "Bearer sk-SYNTHETIC-G0" else "unexpected")
        data = b'{"error":{"message":"Synthetic model deliberately unavailable","code":"offline"}}'
        self.send_response(503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if background(self):
            return
        if self.path not in ("/v1/models", "/v1/models?client_version=0.164.0"):
            invalid.append(True)
            self.send_error(400)
            return
        data = b'{"models":[]}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.timeout = 3
thread = threading.Thread(target=server.serve_forever)
thread.start()


def run(root, unsafe):
    private = root / ("unsafe-config" if unsafe else "healthy-config")
    canonical = root / ("unsafe-history" if unsafe else "healthy-history")
    private.mkdir(mode=0o700)
    canonical.mkdir(mode=0o700)
    history = canonical / "history.jsonl"
    if unsafe:
        history.write_text("")
        history.chmod(0o644)
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
[projects.{json.dumps(str(root))}]
trust_level = "trusted"
'''
    (private / "config.toml").write_text(config)
    (private / "config.toml").chmod(0o600)
    env = {**environment(server.server_port), "PATH": os.environ["PATH"], "HOME": str(private), "CODEX_HOME": str(private),
           "CODEX_AUTH_HOME": str(root / "auth"), "CODEX_MESSAGE_HISTORY_HOME": str(canonical),
           "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", "TERM": "xterm-256color",
           "COLORTERM": "truecolor", "TOKIO_WORKER_THREADS": "2", "RUST_LOG": "off"}
    if args.without_selector:
        env.pop("CODEX_MESSAGE_HISTORY_HOME")
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
    child = subprocess.Popen(["prlimit", "--data=536870912", "--stack=16777216", "--core=0", "--",
                              str(args.binary), "--no-daemon", "--no-alt-screen"], cwd=root, env=env,
                             stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    output = bytearray()
    before = len(observed)
    started = time.monotonic()
    sent = False
    typed_at = None
    prompt = b"Synthetic prompt history. Do not invoke tools."
    try:
        while time.monotonic() - started < 20 and child.poll() is None:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 16384)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                output.extend(chunk)
                if len(output) > 256 * 1024:
                    raise AssertionError("Finite native TUI output limit exceeded.")
                for query, reply in [(b"\x1b[6n", b"\x1b[1;1R"), (b"\x1b[c", b"\x1b[?1;2c"),
                                     (b"\x1b[?u", b"\x1b[?0u"), (b"\x1b]10;?", b"\x1b]10;rgb:ffff/ffff/ffff\x07"),
                                     (b"\x1b]11;?", b"\x1b]11;rgb:0000/0000/0000\x07")]:
                    if query in chunk:
                        os.write(master, reply)
            if typed_at is None and b"synthetic-model" in output and time.monotonic() - started >= 2:
                os.write(master, prompt)
                typed_at = time.monotonic()
            if typed_at is not None and not sent and time.monotonic() - typed_at >= 0.5:
                os.write(master, b"\r")
                sent = True
            if sent and len(observed) > before:
                break
    finally:
        stop_process_group(child)
        # A fatal refusal can exit before the next loop iteration; retain its
        # bounded final diagnostic instead of mistaking a crash for admission.
        while select.select([master], [], [], 0)[0]:
            try:
                final = os.read(master, 16384)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not final:
                break
            output.extend(final)
            assert len(output) <= 256 * 1024, "Finite native TUI output limit exceeded."
        os.close(master)
        if args.diagnostics:
            args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
            diagnostic = args.diagnostics.with_name(args.diagnostics.name + (".unsafe" if unsafe else ".healthy"))
            diagnostic.write_bytes(output)
            diagnostic.chmod(0o600)
    assert sent, "The actual native TUI must reach its model input before this control is meaningful."
    expected = ["G0"] if not unsafe or args.expect_unsafe_execution else []
    assert observed[before:] == expected, "Unsafe selected native prompt history must refuse before a model request."
    if unsafe and not args.expect_unsafe_execution:
        assert child.returncode != 0
        assert b"Canonical prompt history is unavailable; no turn was sent." in output, "Zero requests must accompany explicit native history refusal."
    if unsafe:
        assert history.read_bytes() == b"", "Refused execution must preserve the unsafe history file."
        assert history.stat().st_mode & 0o777 == 0o644
    if not args.expect_private_history:
        assert not (private / "history.jsonl").exists(), "Canonical selection must not write private history."
    if not unsafe:
        selected = private / "history.jsonl" if args.expect_private_history else history
        assert "Synthetic prompt history" in selected.read_text(), "The healthy native TUI must persist the submitted prompt."
    print("PASS: " + ("unsafe native prompt history " + ("reproduces model execution" if args.expect_unsafe_execution else "refuses model execution") if unsafe else "healthy native TUI persists history and reaches the synthetic model"))


try:
    with tempfile.TemporaryDirectory(prefix="hive-3785-native-tui-") as temporary:
        root = Path(temporary)
        (root / "auth").mkdir(mode=0o700)
        auth = root / "auth/auth.json"
        auth.write_text(json.dumps({"OPENAI_API_KEY": "sk-SYNTHETIC-G0"}))
        auth.chmod(0o600)
        run(root, False)
        run(root, True)
        assert not invalid, f"Only declared local synthetic endpoints may be used: {invalid!r}."
finally:
    server.shutdown()
    server.server_close()
    thread.join()
