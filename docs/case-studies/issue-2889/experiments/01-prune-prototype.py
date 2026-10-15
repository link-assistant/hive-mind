# Issue #2889 experiment 1: a fail-closed gated container holds idle when started again,
# so its tagged build caches can be pruned before `docker commit`.
# Run: python3 -I docs/case-studies/issue-2889/experiments/01-prune-prototype.py
import subprocess, sys, json, time, os

IMG = 'rhysd/actionlint:1.7.12'
NAME = 'kr2889-exp'


def run(*args, check=False):
    p = subprocess.run(list(args), capture_output=True, text=True)
    print('$', ' '.join(args)[:200], '->', p.returncode, (p.stdout.strip() + ' ' + p.stderr.strip())[:400])
    return p


run('docker', 'rm', '-f', NAME)
run('docker', 'image', 'rm', 'kr2889/snap:1')
# 1. Fail-closed gated task container: first run creates a fake cargo target and a source file, then is killed.
gate = 'gate=/tmp/hive-mind-disk-baseline-x; while [ ! -e "$gate" ]; do sleep 0.1; done; rm -f "$gate"; exec sh -c "mkdir -p /tmp/ws/src /tmp/ws/target /tmp/ws/node_modules/.cache; echo fn > /tmp/ws/src/main.rs; printf \'Signature: 8a477f597d28d172789f06886806bc55\\n\' > /tmp/ws/target/CACHEDIR.TAG; head -c 30000000 /dev/zero > /tmp/ws/target/big; head -c 5000000 /dev/zero > /tmp/ws/node_modules/.cache/c; sleep 1000"'
handoff = ['sh', '-c', 'p=$1; shift; if [ -f "$p" ]; then exec sh "$p"; fi; exec "$@"', 'start-command-handoff', '/.start-command-resume-' + NAME, 'sh', '-c', gate]
run('docker', 'create', '--name', NAME, '--entrypoint', '', IMG, *handoff)
run('docker', 'start', NAME)
time.sleep(1)
run('docker', 'exec', NAME, 'touch', '/tmp/hive-mind-disk-baseline-x')
time.sleep(3)
run('docker', 'kill', NAME)
p = run('docker', 'inspect', '--size', '-f', '{{.SizeRw}} {{json .Config.Cmd}} {{.State.Status}}', NAME)
# 2. Restart: the gate is gone, so the fail-closed loop holds; prune caches; kill.
run('docker', 'start', NAME)
time.sleep(1)
run('docker', 'exec', NAME, 'ps')
prune = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '01-prune-prototype.sh')).read()
run('docker', 'exec', NAME, 'sh', '-c', prune)
run('docker', 'kill', NAME)
run('docker', 'inspect', '--size', '-f', '{{.SizeRw}} {{.State.Status}} {{.State.ExitCode}}', NAME)
run('docker', 'commit', NAME, 'kr2889/snap:1')
run('docker', 'run', '--rm', '--entrypoint', 'sh', 'kr2889/snap:1', '-c', 'ls -la /tmp/ws /tmp/ws/target /tmp/ws/node_modules; cat /tmp/ws/src/main.rs')
run('docker', 'rm', '-f', NAME)
run('docker', 'image', 'rm', 'kr2889/snap:1')
