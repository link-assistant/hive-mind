"""Run the backup smoke test against an authenticated SSH server on loopback."""

import base64
import os
import shutil
import socketserver
import subprocess
import sys
import threading
from pathlib import Path

import paramiko


class Session(paramiko.ServerInterface):
    def __init__(self, key):
        self.key = key
        self.ready = threading.Event()
        self.command = None

    def get_allowed_auths(self, username):
        return "publickey"

    def check_auth_publickey(self, username, key):
        return paramiko.AUTH_SUCCESSFUL if username == "fixture" and key == self.key else paramiko.AUTH_FAILED

    def check_channel_request(self, kind, chanid):
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_exec_request(self, channel, command):
        if not command.startswith(b"exec bash -c "):
            return False
        self.command = command
        self.ready.set()
        return True


def forward_input(channel, process):
    with channel.makefile("rb") as stream, process.stdin:
        try:
            shutil.copyfileobj(stream, process.stdin)
        except BrokenPipeError:
            pass


def forward_output(stream, send):
    while data := stream.read1(64 * 1024):
        send(data)


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        session = Session(self.server.client_key)
        with paramiko.Transport(self.request) as transport:
            transport.add_server_key(self.server.host_key)
            transport.start_server(server=session)
            channel = transport.accept(10)
            if channel is None or not session.ready.wait(10):
                return
            with channel, subprocess.Popen(
                ["/bin/sh", "-c", session.command], env={**os.environ, "PATH": self.server.remote_path},
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            ) as process:
                stdin = threading.Thread(target=forward_input, args=(channel, process), daemon=True)
                stderr = threading.Thread(target=forward_output, args=(process.stderr, channel.sendall_stderr))
                stdin.start()
                stderr.start()
                forward_output(process.stdout, channel.sendall)
                stderr.join()
                channel.send_exit_status(process.wait())
            transport.join(1)


if __name__ == "__main__":
    authorized_key, remote_path = sys.argv[1:]
    key_type, key_data, *_ = Path(authorized_key).read_text().split()
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler) as server:
        server.client_key = paramiko.PKey.from_type_string(key_type, base64.b64decode(key_data))
        server.host_key = paramiko.RSAKey.generate(2048)
        server.remote_path = remote_path
        port = server.server_address[1]
        print(port)
        print(f"[127.0.0.1]:{port} {server.host_key.get_name()} {server.host_key.get_base64()}", flush=True)
        server.serve_forever()
