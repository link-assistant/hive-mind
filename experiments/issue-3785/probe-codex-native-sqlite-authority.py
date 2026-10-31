#!/usr/bin/env python3
"""Bounded actual-CLI admission probe; no credentials or model requests."""
import argparse
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import tempfile
import time

REFUSAL = "Canonical SQLite configuration is unavailable or unsafe."


class NativeRefusal(Exception):
    """A native response or exit may carry the specific admission error."""


def exercise(binary, root, override, prepare=None, strict_config=False):
    canonical, configuration, redirected = (root / name for name in ("canonical", "configuration", "redirected"))
    for directory in (root, canonical, configuration, redirected):
        directory.mkdir(mode=0o700, exist_ok=True)
    config = 'model_provider="offline"\n[features]\nremote_plugin=false\napps=false\n'
    if override == "configuration":
        config = "sqlite_home=" + json.dumps(str(redirected)) + "\n" + config
    elif override == "logs":
        config = "log_dir=" + json.dumps(str(redirected)) + "\n" + config
    config += '[model_providers.offline]\nname="Offline"\nbase_url="http://127.0.0.1:1/v1"\nwire_api="responses"\nrequires_openai_auth=false\n'
    (configuration / "config.toml").write_text(config)
    if prepare is not None:
        prepare(canonical, configuration, redirected)
    environment = {
        "PATH": os.environ.get("PATH", ""), "HOME": str(root),
        "CODEX_HOME": str(configuration), "CODEX_SQLITE_HOME": str(canonical),
        "CODEX_ROLLOUT_HOME": str(canonical),
        "TOKIO_WORKER_THREADS": "2", "RUST_LOG": "off",
        "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1",
        "HTTP_PROXY": "http://127.0.0.1:1", "HTTPS_PROXY": "http://127.0.0.1:1",
        "ALL_PROXY": "http://127.0.0.1:1", "NO_PROXY": "127.0.0.1,localhost",
    }
    with (root / "native-stderr.log").open("wb") as diagnostics:
        arguments = [
            "prlimit", "--data=536870912", "--stack=16777216", "--core=0", "--",
            str(binary), "app-server",
        ]
        if strict_config:
            arguments.append("--strict-config")
        if override == "cli":
            arguments.extend(["-c", "sqlite_home=" + json.dumps(str(redirected))])
        child = subprocess.Popen(arguments, cwd=root, env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=diagnostics, start_new_session=True)
        buffered = b""
        received = 0
        sequence = 0

        def request(method, params):
            nonlocal buffered, received, sequence
            sequence += 1
            child.stdin.write((json.dumps({"id": sequence, "method": method, "params": params}) + "\n").encode())
            child.stdin.flush()
            deadline = time.monotonic() + 15
            while True:
                while b"\n" in buffered:
                    line, buffered = buffered.split(b"\n", 1)
                    response = json.loads(line)
                    if response.get("id") == sequence:
                        if "error" in response:
                            raise NativeRefusal(json.dumps(response["error"]))
                        return response["result"]
                remaining = deadline - time.monotonic()
                assert remaining > 0 and select.select([child.stdout], [], [], remaining)[0], "Finite native metadata deadline exceeded."
                block = os.read(child.stdout.fileno(), 65536)
                if not block:
                    raise NativeRefusal("Native CLI exited before its metadata response.")
                received += len(block)
                assert received <= 262144, "Native metadata output exceeded its fixed bound."
                buffered += block

        failure = None
        try:
            request("initialize", {"clientInfo": {"name": "hive-sqlite-authority-probe", "version": "1.0.0"}})
            child.stdin.write(b'{"method":"initialized"}\n')
            child.stdin.flush()
            request("thread/list", {"limit": 1})
        except (NativeRefusal, BrokenPipeError) as error:
            failure = error
        finally:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait(timeout=5)
            try:
                child.stdin.close()
            except BrokenPipeError:
                pass
            child.stdout.close()
    diagnostics_path = root / "native-stderr.log"
    assert diagnostics_path.stat().st_size <= 262144, "Native diagnostic output exceeded its fixed bound."
    refused = failure is not None and (REFUSAL in str(failure) or REFUSAL.encode() in diagnostics_path.read_bytes())
    assert failure is None or refused, "Native failure did not carry the expected SQLite admission refusal."
    databases = {}
    for name, directory in (("canonical", canonical), ("private", configuration), ("redirected", redirected)):
        entries = list(directory.rglob("*"))
        assert len(entries) <= 100, "Native fixture entries exceeded their fixed bound."
        databases[name] = sorted(str(entry.relative_to(directory)) for entry in entries if entry.is_file() and ".sqlite" in entry.name)
    return databases, refused


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("binary", type=Path)
    parser.add_argument("--expect-redirect", action="store_true")
    parser.add_argument("--diagnostics", action="store_true", help="Print synthetic fixture database paths and refusal state.")
    parser.add_argument("--strict-config", action="store_true", help="Control the existing native strict policy independently of the adapter.")
    parser.add_argument("--case", choices=["configuration", "cli", "logs"], default="configuration")
    args = parser.parse_args()
    assert args.binary.is_absolute() and args.binary.is_file()
    with tempfile.TemporaryDirectory(prefix="hive-codex-sqlite-authority-") as temporary:
        root = Path(temporary)
        baseline, refused = exercise(args.binary, root / "baseline", None, strict_config=args.strict_config)
        assert not refused and baseline["canonical"] and not baseline["private"] and not baseline["redirected"], "Healthy native SQLite selection must write only canonical databases."
        print("PASS: actual native metadata requests create their databases in CODEX_SQLITE_HOME.", flush=True)
        redirected, refused = exercise(args.binary, root / "override", args.case, strict_config=args.strict_config)
        if args.diagnostics:
            print(json.dumps({"case": args.case, "databases": redirected, "refused": refused}), flush=True)
        if args.expect_redirect:
            assert not refused and redirected["redirected"], "The negative control must reproduce actual database redirection."
            if args.case != "logs":
                assert not redirected["canonical"]
            print(f"PASS: {args.case} overrides selected canonical SQLite storage in the actual CLI.", flush=True)
        else:
            assert not redirected["redirected"] and not redirected["private"], "Private configuration redirected acknowledged canonical SQLite storage."
            assert refused and not redirected["canonical"], "Conflicting native configuration must refuse explicitly before opening databases."
            print(f"PASS: conflicting {args.case} refuses native SQLite startup before database creation.", flush=True)


if __name__ == "__main__":
    main()
