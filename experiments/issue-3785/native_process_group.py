"""Stop an isolated native probe and its descendant process group before cleanup."""
import os
from pathlib import Path
import signal
import time


def _has_live_members(group):
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            # comm can contain spaces and parentheses; fields follow its last ')'.
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
        except (FileNotFoundError, ProcessLookupError):
            continue
        if int(fields[2]) == group and fields[0] != "Z":
            return True
    return False


def stop_process_group(child):
    # The CLI may exit on refusal while a plugin/catalog helper still runs.
    # Its session/group remains valid until the last descendant exits.
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait(timeout=5)
    deadline = time.monotonic() + 5
    while _has_live_members(child.pid):
        if time.monotonic() >= deadline:
            raise RuntimeError("Native probe descendants did not stop before fixture cleanup.")
        time.sleep(0.01)
