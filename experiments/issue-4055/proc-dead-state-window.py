#!/usr/bin/env python3
"""Does /proc/<pid>/stat show `X (dead)` while a zombie is being reaped? (#4055)

A forked helper forks a short-lived grandchild and exits, so the grandchild
is orphaned and reaped by init (or the nearest subreaper) asynchronously, as in
the Router native-lifetime fixture. This process reads the grandchild's stat in
a tight loop and records every state letter it sees. This process is the subreaper and a
thread reaps each orphan. Bounded: N trials, each
grandchild lives about 2 ms, and every read loop stops after 2 s.
"""
import ctypes
import warnings
import os
import sys
import threading
import time

# Where PID 1 never reaps (some containers), act as init: become the child
# subreaper and reap orphans from another thread, asynchronously, as systemd does.
PR_SET_CHILD_SUBREAPER = 36
# The reaper thread has exited before each fork; the warning does not apply.
warnings.filterwarnings("ignore", category=DeprecationWarning, message=".*fork")
if ctypes.CDLL(None, use_errno=True).prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
    raise SystemExit('prctl(PR_SET_CHILD_SUBREAPER) failed')

trials = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
seen = {}
for _ in range(trials):
    read_end, write_end = os.pipe()
    helper = os.fork()
    if helper == 0:
        grandchild = os.fork()
        if grandchild == 0:
            time.sleep(0.002)
            os._exit(0)
        os.write(write_end, str(grandchild).encode())
        os._exit(0)
    os.close(write_end)
    pid = int(os.read(read_end, 32))
    os.close(read_end)
    os.waitpid(helper, 0)
    reaper = threading.Thread(target=os.waitpid, args=(pid, 0))
    reaper.start()
    states = []
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            with open(f'/proc/{pid}/stat') as stat:
                state = stat.read().rsplit(') ', 1)[1][0]
        except (FileNotFoundError, ProcessLookupError):
            break
        if not states or states[-1] != state:
            states.append(state)
    reaper.join()
    key = ''.join(states)
    seen[key] = seen.get(key, 0) + 1
print('state sequences (letter order as observed) -> trials:')
for key, count in sorted(seen.items(), key=lambda item: -item[1]):
    print(f'  {key or "(already gone)"}: {count}')
print('X observed in', sum(count for key, count in seen.items() if 'X' in key), 'of', trials, 'trials')
