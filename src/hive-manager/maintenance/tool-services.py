"""Audit and stop idle vendor helpers using deployment and Linux process state."""

import argparse
from contextlib import nullcontext
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import signal
import sys
import time

from lib.deployment import cgroup, deployment_root, docker, maintenance_lock, process_stat
from lib.paths import at_path, info_at, read_config


TOOLS = ('codex', 'claude')
DEAD = ('Z', 'X')
TASK_LABEL = 'start-command.uuid'
UUID = re.compile(r'^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$', re.I)
TOOLS_IN_COMMAND = re.compile(r'(?:^|\s)--tool(?:=|\s+)(codex|claude|agent|gemini|qwen|opencode)(?=\s|$)')
SOLVE = re.compile(r'(?:^|[ /])solve(?:\.mjs)?\s+https://github\.com/\S+')


def classify(args, comm, executable):
    if not args:
        return None, None
    first = Path(args[0]).name
    words = args[1:]
    binary = Path(executable.removesuffix(' (deleted)'))
    tool = first if first in TOOLS else comm if comm in TOOLS else None
    known_binary = tool and (
        binary.name == tool or
        (tool == 'claude' and '/.local/share/claude/versions/' in str(binary)
         and re.fullmatch(r'\d+\.\d+\.\d+(?:[-.\w]+)?', binary.name))
    )
    if binary.name in ('node', 'bun', 'nodejs') and words:
        index = 0
        while index < len(words) and words[index].startswith('-'):
            index += 2 if words[index] in ('--require', '-r', '--import', '--loader') else 1
        if index < len(words):
            script = words[index]
            if re.search(r'/@openai/codex/(?:[^/]+/)*codex\.js$', script):
                tool, known_binary = 'codex', True
            elif re.search(r'/@anthropic-ai/claude-code/(?:[^/]+/)*cli\.js$', script):
                tool, known_binary = 'claude', True
            words = words[index + 1:]
    if not tool:
        return None, None
    if known_binary:
        if tool == 'codex' and words[:3] == ['app-server', 'daemon', 'pid-update-loop']:
            return tool, 'updater'
        if tool == 'codex' and words[:1] == ['app-server'] and '--managed-daemon' in words[1:]:
            flags = iter(words[1:])
            if all(word in ('--managed-daemon', '--analytics-default-enabled') or
                   (word == '--listen' and next(flags, None) == 'unix://') or word == '--listen=unix://' for word in flags):
                return tool, 'managed-daemon'
        if tool == 'claude' and len(words) == 1 and words[0] in ('--claude-in-chrome-mcp', '--chrome-native-host'):
            return tool, 'browser-helper'
    return tool, 'foreground'


def read_process(pid):
    directory = Path('/proc') / str(pid)
    comm, fields = process_stat(pid)
    argv = (directory / 'cmdline').read_bytes().rstrip(b'\0').decode(errors='replace').split('\0')
    groups = cgroup(pid)
    try:
        exe = os.readlink(directory / 'exe')
    except FileNotFoundError:
        exe = ''
    tool, role = classify(argv, comm, exe)
    launcher = next((index for index, arg in enumerate(argv[:2]) if Path(arg).name in ('solve', 'solve.mjs')), None)
    starting = task_tool(' '.join(argv[launcher:])) if launcher is not None else None
    return dict(pid=int(pid), ppid=int(fields[1]), start=int(fields[19]), tty=int(fields[4]),
                state=fields[0], cgroup=groups, tool=tool, role=role, executable=exe, starting=starting)


def task_tool(command):
    if not isinstance(command, str):
        return 'unknown'
    command = command.replace("'", '').replace('"', '')
    match = TOOLS_IN_COMMAND.search(command)
    if match:
        return match[1]
    for tool in TOOLS:
        if re.match(rf'^\s*/{tool}(?:\s|$)', command):
            return tool
    # A default solve can select its tool through deployment configuration.
    return 'unknown'


def running_containers(call=docker):
    ids = call('ps', '--quiet', '--no-trunc').split()
    for index in range(0, len(ids), 100):
        yield from json.loads(call('container', 'inspect', *ids[index:index + 100]))


def current_records(directory, inside):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        def read(name):
            with at_path(fd, 'home/box/.start-command/' + name) as (parent, leaf):
                info = info_at(parent, leaf) if parent is not None else None
                return read_config(parent, leaf, info, set(), limit=16 * 1024 * 1024) if info else None

        primary = 'executions.lino'
        cached = 'executions.decoded.js.json'
        for refresh in (False, True):
            if refresh:
                inside('$', '--list', '--running', '--output-format', 'json')
            source = read(primary)
            if source is None:
                # A new deployment can have no store yet. Other store files
                # without their source cannot establish that tasks are idle.
                if read(cached) is None and read('executions.links') is None:
                    return []
                break
            try:
                copy = json.loads(read(cached) or b'{}')
            except ValueError:
                continue
            if (isinstance(copy, dict) and copy.get('format') == 'start-command-decoded-store-js-1'
                    and copy.get('sha256') == sha256(source).hexdigest()
                    and isinstance(copy.get('records'), list) and source == read(primary)):
                return copy['records']
        raise ValueError('Cannot verify the current start-command execution store.')
    finally:
        os.close(fd)


def scan_tasks(root, directory, nested):
    active = set()
    root_id = root['Id']

    def inside(*args):
        return docker('exec', '--user', 'box', root_id, *args)

    for record in current_records(directory, inside):
        if not isinstance(record, dict) or not isinstance(record.get('status'), str):
            raise ValueError('Cannot verify a running start-command execution.')
        if record['status'] != 'executed':
            active.add(task_tool(record.get('command')))
    sources = [running_containers()]
    if nested:
        sources.append(running_containers(lambda *args: inside('docker', *args)))
    for containers in sources:
        for entry in containers:
            if entry['Id'] == root_id:
                continue
            config = entry['Config']
            command = ' '.join([*(config.get('Entrypoint') or []), *(config.get('Cmd') or [])])
            labels = config.get('Labels') or {}
            if TASK_LABEL in labels or UUID.fullmatch(entry['Name'].lstrip('/')) or SOLVE.search(command.replace("'", '').replace('"', '')):
                active.add(task_tool(command))
    return active


def observe(name):
    with deployment_root(name) as (container, directory, identity, recheck):
        env = dict(item.split('=', 1) for item in container['Config'].get('Env') or [] if '=' in item)
        nested = bool(env.get('DOCKER_HOST')) or (directory / 'run/docker.sock').is_socket()
        tasks = scan_tasks(container, directory, nested)
        processes = {}
        for path in Path('/proc').iterdir():
            if path.name.isdecimal():
                try:
                    row = read_process(path.name)
                    processes[row['pid']] = row
                except (FileNotFoundError, ProcessLookupError):
                    pass
        recheck()
        return dict(identity=identity, tasks=tasks, processes=processes)


def in_scope(process, root_group, include_host):
    return process['cgroup'] == root_group or (
        include_host and not re.search(r'docker|containerd|kubepods|libpod|lxc|/[a-f0-9]{64}(?:/|$)', process['cgroup'], re.M)
    )


def service_plan(snapshot, tool, include_host):
    _, root_pid, _, root_group = snapshot['identity']
    processes = snapshot['processes']
    own = [p for p in processes.values() if p['tool'] == tool and p['state'] not in DEAD]
    candidates = [p for p in own if p['role'] != 'foreground' and in_scope(p, root_group, include_host)]
    blockers = set()
    if snapshot['tasks'] & {tool, 'unknown'} or any(
        p.get('starting') in (tool, 'unknown') and p['state'] not in DEAD and in_scope(p, root_group, include_host)
        for p in processes.values()
    ):
        blockers.add('active or unclassified task')
    if any(p['role'] == 'foreground' and in_scope(p, root_group, include_host) for p in own):
        blockers.add('foreground CLI, login or unknown execution mode')
    for process in candidates:
        peers = {p['pid'] for p in candidates if p['cgroup'] == process['cgroup']}
        if process['tty']:
            blockers.add('helper has a controlling terminal')
        init = root_pid if process['cgroup'] == root_group else 1
        if process['ppid'] not in peers | {init}:
            blockers.add('helper has a live or unverified owner')
        if any(p['ppid'] == process['pid'] and p['pid'] not in peers and p['state'] not in DEAD for p in processes.values()):
            blockers.add('helper has a live worker child')
    return sorted(candidates, key=lambda p: (p['role'] != 'updater', p['pid'])), sorted(blockers)


def same_process(expected, current):
    return current is not None and current['state'] not in DEAD and all(
        expected[key] == current[key] for key in ('pid', 'start', 'tool', 'role', 'cgroup', 'executable')
    )


def signal_helper(process, sig, identity, observer, include_host):
    try:
        fd = os.pidfd_open(process['pid'])
    except ProcessLookupError:
        return 'gone'
    try:
        snapshot = observer()
        if snapshot['identity'] != identity:
            raise ValueError('Deployment container changed before signal.')
        candidates, blockers = service_plan(snapshot, process['tool'], include_host)
        current = snapshot['processes'].get(process['pid'])
        if not same_process(process, current):
            return 'gone-or-changed'
        if blockers or not any(p['pid'] == process['pid'] for p in candidates):
            return 'protected-by-new-work'
        # Refresh process identity after the task scan, immediately before signaling.
        fresh = read_process(process['pid'])
        if not same_process(process, fresh) or fresh['ppid'] != current['ppid'] or fresh['tty']:
            return 'gone-or-changed'
        signal.pidfd_send_signal(fd, sig)
        return 'signalled'
    except (FileNotFoundError, ProcessLookupError):
        return 'gone'
    finally:
        os.close(fd)


def describe(snapshot, tools, include_host):
    entries = []
    for tool in tools:
        candidates, blockers = service_plan(snapshot, tool, include_host)
        entries.append({'tool': tool, 'helpers': [{'pid': p['pid'], 'role': p['role']} for p in candidates], 'blockers': blockers})
    return entries


def cleanup(observer, tools, apply, include_host):
    before = observer()
    result = {'applied': apply, 'plans': describe(before, tools, include_host), 'signals': [], 'remaining': None, 'error': None}
    try:
        if apply:
            for tool in tools:
                candidates, blockers = service_plan(before, tool, include_host)
                if blockers:
                    continue
                for process in candidates:
                    status = signal_helper(process, signal.SIGTERM, before['identity'], observer, include_host)
                    result['signals'].append(dict(tool=tool, pid=process['pid'], signal='TERM', status=status))
                    if status != 'signalled':
                        continue
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline:
                        try:
                            if not same_process(process, read_process(process['pid'])):
                                break
                        except (FileNotFoundError, ProcessLookupError):
                            break
                        time.sleep(0.2)
                    else:
                        status = signal_helper(process, signal.SIGKILL, before['identity'], observer, include_host)
                        result['signals'].append(dict(tool=tool, pid=process['pid'], signal='KILL', status=status))
            after = observer()
            if after['identity'] != before['identity']:
                raise ValueError('Deployment container changed during cleanup.')
            result['remaining'] = describe(after, tools, include_host)
    except ValueError as error:
        result['error'] = str(error)
    except (OSError, KeyError, TypeError):
        result['error'] = 'Could not safely verify or signal a vendor helper.'
    return result


def main():
    parser = argparse.ArgumentParser(prog='hive-manager deploy tool-services', description=__doc__)
    parser.add_argument('--container', required=True, help=argparse.SUPPRESS)
    parser.add_argument('--tools', default=','.join(TOOLS), help='Comma-separated codex and/or claude (default: both)')
    parser.add_argument('--include-host', action='store_true', help='Include eligible host helpers')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true', help='Stop eligible services after fresh checks')
    mode.add_argument('--dry-run', action='store_true', help='Preview eligible services (default)')
    args = parser.parse_args()
    tools = list(dict.fromkeys(args.tools.split(',')))
    if any(tool not in TOOLS for tool in tools):
        parser.error('Select codex and/or claude with --tools.')
    if os.geteuid() != 0:
        parser.error('Run as root on the selected Linux Docker host.')
    try:
        with maintenance_lock('tool-services') if args.apply else nullcontext():
            result = cleanup(lambda: observe(args.container), tools, args.apply, args.include_host)
        print(json.dumps(result, indent=2))
        return int(bool(result['error']))
    except (OSError, ValueError, KeyError, TypeError):
        print('Could not safely observe the deployment or obtain its tool service lock.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
