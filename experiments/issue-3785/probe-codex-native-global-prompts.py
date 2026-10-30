#!/usr/bin/env python3
"""Verify global instruction audit against real, bounded native model requests."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from native_network_fixture import background, environment, refuse_connect
from native_process_group import stop_process_group

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("binary", type=Path)
parser.add_argument("--expect-missed-prompts", action="store_true")
parser.add_argument("--diagnostics", type=Path)
args = parser.parse_args()
assert args.binary.is_absolute() and args.binary.is_file()
marker = "SYNTHETIC_GLOBAL_SYSTEM_INSTRUCTION_3785"
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
        body = json.loads(self.rfile.read(length))
        if self.headers.get("Authorization") != "Bearer sk-SYNTHETIC-G0":
            invalid.append(True)
            self.send_error(400)
            return
        if args.diagnostics:
            descriptor = os.open(args.diagnostics, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "ab") as log:
                log.write(json.dumps(body).encode()[:256 * 1024] + b"\n")
        # The pinned Responses serializer places base instructions in an input
        # developer message, rather than the API's optional instructions field.
        observed.append(any(item.get("role") in ("developer", "system") and
                            any(marker in part.get("text", "") for part in item.get("content", []))
                            for item in body.get("input", [])))
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
        if self.path.split("?", 1)[0] != "/v1/models":
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
server_thread = threading.Thread(target=server.serve_forever)
server_thread.start()
repository = Path(__file__).resolve().parents[2]


def native(root, home):
    endpoint = f"http://127.0.0.1:{server.server_port}"
    env = dict(PATH=os.environ["PATH"], HOME=str(home), CODEX_HOME=str(home / ".codex"),
               TOKIO_WORKER_THREADS="2", RUST_LOG="off", GIT_CONFIG_GLOBAL="/dev/null",
               GIT_CONFIG_NOSYSTEM="1", **environment(server.server_port))
    before = len(observed)
    with tempfile.TemporaryFile() as output:
        child = subprocess.Popen([
            "prlimit", "--data=536870912", "--stack=16777216", "--fsize=16777216", "--core=0", "--",
            str(args.binary), "exec", "--skip-git-repo-check", "--json",
            "Synthetic request. Do not invoke tools.",
        ], cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True)
        try:
            child.wait(timeout=20)
        finally:
            stop_process_group(child)
        output.seek(0)
        diagnostic = output.read(1024 * 1024)
        if args.diagnostics:
            descriptor = os.open(args.diagnostics, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "ab") as log:
                log.write(diagnostic)
        assert child.returncode == 1, f"The synthetic provider deliberately refuses inference (exit {child.returncode})."
        assert endpoint.encode() in diagnostic, "Native diagnostics must identify the loopback provider."
    assert len(observed) == before + 1, "One real native model request is required per control."
    return observed[-1]


def audit(root, home, repair=False):
    module = (repository / "src/agent-config-audit.lib.mjs").as_uri()
    script = f'''
import assert from 'node:assert/strict';
import {{ runAgentConfigAudit }} from {json.dumps(module)};
try {{
  await runAgentConfigAudit({{ tool: 'codex', homeDir: process.argv[1], env: {{}},
    systemRoots: {{codex: process.argv[2], claude: process.argv[3]}},
    requireClean: true, autoRepair: {str(repair).lower()} }});
  process.stdout.write('ACCEPTED');
}} catch (error) {{
  assert.match(error.message, /not clean/iu);
  process.stdout.write('REFUSED');
}}
'''
    result = subprocess.run(["prlimit", "--stack=16777216", "--core=0", "--",
                             "node", "--max-old-space-size=64", "--input-type=module", "-e", script, str(home), str(root / "managed-codex"),
                             str(root / "managed-claude")], cwd=repository,
                            env={"PATH": os.environ["PATH"], "HOME": str(home)},
                            capture_output=True, check=True, timeout=20)
    return result.stdout.decode()


try:
    with tempfile.TemporaryDirectory(prefix="hive-native-global-prompts-") as directory:
        root = Path(directory)
        home = root / "home"
        config_dir = home / ".codex"
        config_dir.mkdir(parents=True, mode=0o700)
        endpoint = f"http://127.0.0.1:{server.server_port}"
        config = config_dir / "config.toml"
        config.write_text(f'''instructions = "{marker}"
model = "synthetic-model"
model_provider = "offline"
chatgpt_base_url = "{endpoint}/backend-api"
approval_policy = "never"
sandbox_mode = "read-only"
[features]
remote_plugin = false
apps = false
enable_request_compression = false
[model_providers.offline]
name = "Offline"
base_url = "{endpoint}/v1"
model_catalog_url = "{endpoint}/v1/models"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 0
stream_max_retries = 0
''')
        auth = config_dir / "auth.json"
        auth.write_text('{"OPENAI_API_KEY":"sk-SYNTHETIC-G0"}')
        auth.chmod(0o600)
        original = auth.stat()
        assert native(root, home), "The unapproved global instruction must reach an actual model request."
        before = config.read_bytes()
        assert audit(root, home) == ("ACCEPTED" if args.expect_missed_prompts else "REFUSED")
        assert config.read_bytes() == before, "Read-only admission must preserve configuration."
        if args.expect_missed_prompts:
            print("REPRODUCED: an accepted global system instruction reached a real native model request.")
        else:
            assert audit(root, home, repair=True) == "ACCEPTED"
            assert not native(root, home), "Repair must restore native instructions without changing the provider."
            assert audit(root, home) == "ACCEPTED"
            assert (auth.stat().st_dev, auth.stat().st_ino) == (original.st_dev, original.st_ino)
            assert auth.read_text() == '{"OPENAI_API_KEY":"sk-SYNTHETIC-G0"}'
            print("PASS: actual native request contained the global override before repair and native instructions after repair; auth identity survived.")
        assert not invalid, "No undeclared or external endpoint may be used."
finally:
    server.shutdown()
    server.server_close()
    server_thread.join(timeout=5)
    assert not server_thread.is_alive()
