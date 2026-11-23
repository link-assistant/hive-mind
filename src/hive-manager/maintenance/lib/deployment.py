"""Linux host observations shared by deployment maintenance commands."""

from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess


def docker(*args, input=None):
    try:
        return subprocess.check_output(
            ['docker', *args], input=input, text=True, stderr=subprocess.DEVNULL, timeout=30
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError(f'Docker {args[0]} failed on the deployment host.') from error


def process_stat(pid):
    raw = (Path('/proc') / str(pid) / 'stat').read_text()
    end = raw.rindex(')')
    return raw[raw.index('(') + 1:end], raw[end + 2:].split()


def cgroup(pid):
    return (Path('/proc') / str(pid) / 'cgroup').read_text().strip()


def belongs_to_container(groups, container_id):
    return any(
        part in (container_id, f'docker-{container_id}.scope')
        for line in groups.splitlines() for part in line.split(':', 2)[-1].split('/')
    )


def root_container(name):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', name):
        raise ValueError('Invalid deployment container name.')
    container, = json.loads(docker('container', 'inspect', name))
    state = container['State']
    pid = state['Pid']
    if container['Name'] != '/' + name or not state['Running'] or state['Paused'] or pid <= 1:
        raise ValueError('Expected the selected deployment container to be running.')
    if 'start-command.uuid' in (container['Config'].get('Labels') or {}):
        raise ValueError('Select the root deployment instead of a task container.')
    groups = cgroup(pid)
    if not belongs_to_container(groups, container['Id']):
        raise ValueError('Run on the Linux Docker host with access to the deployment process namespace.')
    _, fields = process_stat(pid)
    return container, (container['Id'], pid, int(fields[19]), groups)


@contextmanager
def deployment_root(name):
    container, identity = root_container(name)
    fd = os.open(f'/proc/{identity[1]}/root', os.O_PATH | os.O_DIRECTORY)
    try:
        def recheck():
            if root_container(name)[1] != identity:
                raise ValueError('Deployment container changed during maintenance.')
        recheck()
        yield container, Path(f'/proc/self/fd/{fd}'), identity, recheck
    finally:
        os.close(fd)


STATE = Path('/var/lib/hive-manager/tool-maintenance')


def private_directory(path):
    # The caller runs as root. Verify each managed component before using it.
    ancestor = path.parent
    if ancestor != Path('/'):
        info = ancestor.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('Unsafe host maintenance state parent.')
    path.mkdir(mode=0o700, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise ValueError('Unsafe host maintenance state directory.')
    return path


@contextmanager
def maintenance_lock(name):
    private_directory(STATE.parent)
    private_directory(STATE)
    fd = os.open(STATE / (name + '.lock'), os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError('Tool maintenance is already active on this host.') from error
        yield
    finally:
        os.close(fd)
