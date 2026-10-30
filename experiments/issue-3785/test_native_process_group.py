"""Regression for native TUI helpers outliving an already-exited CLI."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from native_process_group import stop_process_group


class NativeProcessGroupTests(unittest.TestCase):
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
