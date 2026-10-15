# Issue #2889 experiment 2: start-command's command handoff lets `docker start` run a
# replacement command in the same stopped container, with no commit.
# Run: python3 -I docs/case-studies/issue-2889/experiments/02-command-handoff.py
import subprocess, time, tempfile, os

IMG = 'rhysd/actionlint:1.7.12'
NAME = 'kr2889-exp2'


def run(*args):
    p = subprocess.run(list(args), capture_output=True, text=True)
    print('$', ' '.join(args)[:160], '->', p.returncode, (p.stdout.strip() + ' ' + p.stderr.strip())[:300])
    return p


run('docker', 'rm', '-f', NAME)
gate = 'gate=/tmp/hive-mind-disk-baseline-y; i=0; while [ ! -e "$gate" ] && [ "$i" -lt 300 ]; do i=$((i+1)); sleep 0.1; done; rm -f "$gate"; exec sh -c "echo ORIGINAL-TASK-RAN > /tmp/marker; sleep 1000"'
marker = '/.start-command-resume-' + NAME
handoff = ['sh', '-c', 'p=$1; shift; if [ -f "$p" ]; then exec sh "$p"; fi; exec "$@"', 'start-command-handoff', marker, 'sh', '-c', gate]
run('docker', 'create', '--name', NAME, '--entrypoint', '', IMG, *handoff)
run('docker', 'start', NAME)
run('docker', 'exec', NAME, 'touch', '/tmp/hive-mind-disk-baseline-y')
time.sleep(2)
run('docker', 'exec', NAME, 'cat', '/tmp/marker')
run('docker', 'kill', NAME)
# docker-start resume with a handoff script: no commit, the gate is not re-entered.
d = tempfile.mkdtemp()
f = os.path.join(d, 'command')
open(f, 'w').write('exec sh -c "echo REPLACEMENT-RAN > /tmp/marker2; cat /tmp/marker; sleep 1000"\n')
run('docker', 'cp', f, NAME + ':' + marker)
t = time.time()
run('docker', 'start', NAME)
time.sleep(2)
run('docker', 'exec', NAME, 'sh', '-c', 'cat /tmp/marker2 /tmp/marker; ps')
print('started in', round(time.time() - t, 1), 's')
run('docker', 'rm', '-f', NAME)
