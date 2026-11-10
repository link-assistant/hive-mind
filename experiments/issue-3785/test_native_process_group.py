"""Regression for native TUI helpers outliving an already-exited CLI."""
import os
import importlib.util
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from native_process_group import stop_process_group


class NativeProcessGroupTests(unittest.TestCase):
    def test_native_cleanup_reaps_an_exited_peer_with_a_buffered_request(self):
        spec = importlib.util.spec_from_file_location(
            "native_compression_probe", Path(__file__).with_name("probe-codex-native-compression.py")
        )
        native = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(native)
        child = subprocess.Popen([sys.executable, "-c", "raise SystemExit(78)"],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 text=True, start_new_session=True)
        diagnostics = tempfile.TemporaryFile()
        probe = native.Native.__new__(native.Native)
        probe.child, probe.diagnostics, probe.stopped = child, diagnostics, False
        probe.reader = threading.Thread(target=lambda: None)
        probe.reader.start()
        try:
            child.wait(timeout=5)
            # A refused request can remain buffered after the native peer exits.
            child.stdin.write("pending synthetic request\n")
            probe.stop()
            self.assertTrue(probe.stopped)
            self.assertTrue(child.stdin.closed and child.stdout.closed and diagnostics.closed)
            self.assertEqual(child.returncode, 78)
            probe.stop()
        finally:
            stop_process_group(child)
            for stream in (child.stdin, child.stdout, diagnostics):
                try:
                    stream.close()
                except BrokenPipeError:
                    pass

    def test_descendant_stops_after_leader_already_exited(self):
        with tempfile.TemporaryDirectory(prefix="hive-native-group-") as root:
            marker = Path(root) / "writer.pid"
            writer = """import os, pathlib, sys, time
pathlib.Path(sys.argv[1]).write_text(str(os.getpid()))
time.sleep(30)
"""
            parent = "import subprocess,sys; subprocess.Popen([sys.executable, '-c', sys.argv[1], sys.argv[2]])"
            child = subprocess.Popen([sys.executable, "-c", parent, writer, str(marker)], start_new_session=True)
            try:
                child.wait(timeout=5)
                deadline = time.monotonic() + 5
                while not marker.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(marker.exists(), "The descendant must be running before cleanup.")
                pid = int(marker.read_text())
                stop_process_group(child)
                state = Path(f"/proc/{pid}/stat")
                if state.exists():
                    # A reparented zombie cannot write to the fixture anymore.
                    self.assertEqual(state.read_text().rsplit(")", 1)[1].split()[0], "Z")
            finally:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()

    def test_running_leader_is_reaped_and_repeated_cleanup_is_safe(self):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)
        stop_process_group(child)
        self.assertIsNotNone(child.returncode)
        stop_process_group(child)


if __name__ == "__main__":
    unittest.main()
