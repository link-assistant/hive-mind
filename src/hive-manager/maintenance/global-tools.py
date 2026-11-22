"""Audit and quarantine shared Claude and Codex extensions on a deployment."""

import argparse
from contextlib import ExitStack, nullcontext
import copy
import datetime
import errno
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import tomllib

from lib.deployment import STATE, deployment_root, maintenance_lock, private_directory
from lib.paths import DIRECTORY, MAX_CONFIG, at_path, children, identity, info_at, mount_id, read_config, revision, visit_extension


# Stock entries shipped by the vendor may remain under the .system directory.
STOCK_SKILLS = frozenset({
    'skill-installer', 'skill-creator', 'openai-docs', 'review-agent', 'imagegen',
    '.codex-system-skills.marker',
})
TOOL_HOME_NAMES = ('.codex', '.claude', '.claude.json', '.agents', '.mcp.json')
HOME_INSTRUCTIONS = ('AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md')
USER_PATHS = (
    '.codex/plugins', '.codex/hooks', '.codex/hooks.json', '.codex/.hook-trust',
    '.codex/.tmp/plugins', '.codex/.tmp/plugins.sha', '.codex/.tmp/plugins.sync.lock',
    '.codex/AGENTS.md', '.codex/AGENTS.override.md', '.codex/instructions.md',
    '.codex/agents', '.codex/prompts',
    '.claude/skills', '.claude/plugins', '.claude/hooks', '.claude/agents',
    '.claude/commands', '.claude/rules', '.claude/output-styles', '.claude/CLAUDE.md',
    '.claude/CLAUDE.local.md', '.agents/skills',
) + HOME_INSTRUCTIONS
PROTECTED = (
    '.codex/auth.json', '.codex/sessions', '.codex/archived_sessions',
    '.codex/history.jsonl', '.codex/session_index.jsonl', '.codex/hive-mind',
    '.codex/generated_images', '.claude/.credentials.json', '.claude/projects',
    '.claude/sessions', '.claude/history.jsonl', '.config/gh', '.hive-mind',
    '.start-command', '.git-credentials', '.netrc',
)
SYSTEM_PATHS = ('skills', 'plugins', 'hooks', 'hooks.json', 'agents', 'commands')
ADDON_KEYS = (
    'hooks', 'plugins', 'marketplaces', 'plugin_marketplaces', 'skills', 'notify',
    'enabledPlugins', 'extraKnownMarketplaces', 'pluginConfigs', 'statusLine',
    'outputStyle', 'skillOverrides', 'agent', 'model_instructions_file',
    'experimental_instructions_file', 'developer_instructions', 'instructions',
    'additional_developer_instructions', 'compact_prompt', 'experimental_compact_prompt_file',
    'experimental_realtime_ws_backend_prompt', 'experimental_realtime_ws_startup_context',
    'experimental_realtime_start_instructions', 'model_catalog_json', 'policyHelper',
)
EXTENSION_ENV = (
    'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_PLUGIN_CACHE_DIR',
    'CLAUDE_PLUGIN_ROOT', 'PLUGIN_ROOT', 'CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH',
    'FORCE_AUTOUPDATE_PLUGINS',
)
# Match the cloud capability policy used by the task-launch audit.
CLAUDE_DISABLED_SETTINGS = {
    'syncClaudeAiSkills': False, 'syncClaudeAiPlugins': False,
    'disableClaudeAiConnectors': True, 'allowAllClaudeAiMcps': False, 'disableAllHooks': True,
}
CLAUDE_DISABLED_ENV = {
    'CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL': '1', 'ENABLE_CLAUDEAI_MCP_SERVERS': 'false',
}


def load_policy(path):
    with Path(path).open('rb') as source:
        raw = source.read(MAX_CONFIG + 1)
    if len(raw) > MAX_CONFIG:
        raise ValueError('Tool policy exceeds the size limit.')
    policy = json.loads(raw)
    if not isinstance(policy, dict) or policy.keys() - {'codexMcp', 'claudeMcp'}:
        raise ValueError('Expected a tool policy with codexMcp and/or claudeMcp objects.')
    for servers in policy.values():
        if not isinstance(servers, dict) or any(
            not re.fullmatch(r'[\w-]+', name) or not isinstance(value, dict)
            or not (isinstance(value.get('command'), str) or isinstance(value.get('url'), str))
            for name, value in servers.items()
        ):
            raise ValueError('Invalid MCP allowlist in tool policy.')
    return policy


def table(data, key):
    value = data.get(key, {})
    if not isinstance(value, dict):
        raise ValueError('Expected a configuration object.')
    return value


def scrub(data, kind, policy, defaults=False, main_mcp=False):
    result = copy.deepcopy(data)
    codex = kind in ('codex', 'requirements')
    allowed = policy.get('codexMcp' if codex else 'claudeMcp', {})
    for key in ADDON_KEYS:
        result.pop(key, None)
    if codex:
        if kind == 'requirements':
            result.pop('config_server', None)
        # Scalar agent settings govern concurrency and session behavior.
        if 'agents' in result:
            result['agents'] = {k: v for k, v in table(result, 'agents').items() if not isinstance(v, dict)}
        for key in ('features', 'feature_requirements'):
            if key in result or (key == 'features' and defaults):
                features = table(result, key)
                features.pop('codex_hooks', None)
                for flag in ('remote_plugin', 'plugins', 'apps', 'hooks'):
                    if defaults or flag in features:
                        features[flag] = False
                result[key] = features
        if 'profiles' in result:
            for key, profile in table(result, 'profiles').items():
                if not isinstance(profile, dict):
                    raise ValueError('Expected a Codex profile object.')
                result['profiles'][key] = scrub(profile, kind, policy)
    else:
        result.pop('agents', None)
        for key, value in CLAUDE_DISABLED_SETTINGS.items():
            if defaults or key in result:
                result[key] = value
        if defaults or 'env' in result:
            env = table(result, 'env')
            for key in EXTENSION_ENV:
                env.pop(key, None)
            for key, value in CLAUDE_DISABLED_ENV.items():
                if defaults or key in env:
                    env[key] = value
            result['env'] = env
    if kind != 'requirements':
        for key in ('mcp_servers', 'mcpServers', 'managedMcpServers'):
            if key in result:
                result[key] = {name: config for name, config in table(result, key).items() if name in allowed and config == allowed[name]}
        if main_mcp and allowed:
            result['mcp_servers' if codex else 'mcpServers'] = copy.deepcopy(allowed)
    return result


def toml_value(value):
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, list):
        return '[' + ', '.join(map(toml_value, value)) + ']'
    if isinstance(value, dict):
        return '{ ' + ', '.join(f'{json.dumps(k)} = {toml_value(v)}' for k, v in value.items()) + ' }'
    raise ValueError('Unsupported TOML value.')


def config_bytes(raw, kind, policy, defaults, main_mcp):
    toml = kind in ('codex', 'requirements')
    data = (tomllib.loads(raw.decode()) if toml else json.loads(raw)) if raw is not None else {}
    if not isinstance(data, dict):
        raise ValueError('Expected a configuration object.')
    cleaned = scrub(data, kind, policy, defaults, main_mcp)
    if cleaned == data:
        return raw
    if not toml:
        return (json.dumps(cleaned, indent=2, ensure_ascii=False) + '\n').encode()
    encoded = ''.join(f'{json.dumps(key)} = {toml_value(value)}\n' for key, value in cleaned.items())
    if tomllib.loads(encoded) != cleaned:
        raise ValueError('TOML round trip failed.')
    return encoded.encode()


class Plan:
    def __init__(self, label, root, policy, protected):
        self.label = label
        self.root = root
        self.policy = policy
        self.protected = protected
        self.operations = []
        self.backup = None
        self.error = None

    def quarantine(self, path):
        with at_path(self.root, path) as (parent, name):
            info = info_at(parent, name) if parent is not None else None
            if info and visit_extension(parent, name, mount_id(parent), self.protected):
                self.operations.append(dict(path=path, action='quarantine', revision=revision(info)))

    def config(self, path, kind, defaults=False, main_mcp=False):
        with at_path(self.root, path) as (parent, name):
            info = info_at(parent, name) if parent is not None else None
            allowed = self.policy.get('codexMcp' if kind == 'codex' else 'claudeMcp')
            if info is None and not (defaults or (main_mcp and allowed)):
                return
            original = read_config(parent, name, info, self.protected) if info else None
        updated = config_bytes(original, kind, self.policy, defaults, main_mcp)
        if updated != original:
            self.operations.append(dict(path=path, action='config', revision=revision(info) if info else None, before=original, after=updated))

    def skill_entries(self, path):
        with at_path(self.root, path) as (parent, name):
            info = info_at(parent, name) if parent is not None else None
        if info and stat.S_ISLNK(info.st_mode):
            self.quarantine(path)
            return []
        return children(self.root, path)

    def user(self):
        defaults = self.label == 'bot-user' or any(info_at(self.root, name) for name in TOOL_HOME_NAMES)
        for path in USER_PATHS:
            self.quarantine(path)
        skills = self.skill_entries('.codex/skills')
        for name in skills:
            if name != '.system':
                self.quarantine('.codex/skills/' + name)
        if '.system' in skills:
            for name in self.skill_entries('.codex/skills/.system'):
                path = '.codex/skills/.system/' + name
                with at_path(self.root, path) as (parent, child):
                    info = info_at(parent, child)
                    if name not in STOCK_SKILLS or (info and stat.S_ISLNK(info.st_mode)):
                        self.quarantine(path)
        self.config('.codex/config.toml', 'codex', defaults=defaults, main_mcp=defaults)
        for name in children(self.root, '.codex'):
            if re.fullmatch(r'[\w-]+\.config\.toml', name):
                self.config('.codex/' + name, 'codex')
        self.config('.claude/settings.json', 'claude', defaults=defaults)
        self.config('.claude/settings.local.json', 'claude')
        self.config('.claude.json', 'claude', main_mcp=defaults)
        self.config('.mcp.json', 'claude')

    def system(self, kind):
        for path in SYSTEM_PATHS:
            self.quarantine(path)
        if kind == 'codex':
            for path in ('AGENTS.md', 'AGENTS.override.md', 'prompts'):
                self.quarantine(path)
            for path in ('config.toml', 'managed_config.toml'):
                self.config(path, kind)
            self.config('requirements.toml', 'requirements')
        else:
            for path in ('CLAUDE.md', '.claude/output-styles', 'output-styles', 'rules'):
                self.quarantine(path)
            for path in ('managed-settings.json', 'managed-mcp.json'):
                self.config(path, kind)
            for name in children(self.root, 'managed-settings.d'):
                if not name.startswith('.') and name.endswith('.json'):
                    self.config('managed-settings.d/' + name, kind)

    def verify(self, operation, parent, name):
        info = info_at(parent, name) if parent is not None else None
        if (revision(info) if info else None) != operation['revision']:
            raise ValueError('Global state changed after it was planned.')
        if info and operation['action'] == 'config':
            if read_config(parent, name, info, self.protected) != operation['before']:
                raise ValueError('Global config changed after it was planned.')
        return info

    def prepare(self, backup):
        if not self.operations:
            return
        self.backup = backup / self.label
        self.backup.mkdir(mode=0o700)
        for operation in self.operations:
            if operation.get('before') is not None:
                path = self.backup / 'config' / operation['path']
                path.parent.mkdir(parents=True, exist_ok=True)
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(operation['before'])
                    stream.flush()
                    os.fsync(stream.fileno())

    def verify_all(self):
        for operation in self.operations:
            path = operation['path']
            with at_path(self.root, path) as (parent, name):
                self.verify(operation, parent, name)

    def apply(self):
        for operation in self.operations:
            path = operation['path']
            editing = operation['action'] == 'config'
            with at_path(self.root, path, create=editing) as (parent, name):
                info = self.verify(operation, parent, name)
                if editing:
                    self.rewrite(parent, name, info, operation)
                else:
                    self.move(parent, name, info, self.backup / 'removed' / path)
            operation['applied'] = True

    def move(self, parent, name, info, target):
        parent_mount = mount_id(parent)
        visit_extension(parent, name, parent_mount, self.protected)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.rename(name, target, src_dir_fd=parent)
        except OSError as error:
            if error.errno != errno.EXDEV:
                raise
            visit_extension(parent, name, parent_mount, self.protected, target)
            current = info_at(parent, name)
            if current is None or revision(current) != revision(info):
                raise ValueError('Extension changed during quarantine.')
            if stat.S_ISDIR(info.st_mode):
                shutil.rmtree(name, dir_fd=parent)
            else:
                os.unlink(name, dir_fd=parent)

    def rewrite(self, parent, name, info, operation):
        flags = os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK
        if info is None:
            flags |= os.O_CREAT | os.O_EXCL
        with os.fdopen(os.open(name, flags, 0o600, dir_fd=parent), 'r+b') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if info is not None:
                if revision(os.fstat(handle.fileno())) != revision(info) or handle.read(MAX_CONFIG + 1) != operation['before']:
                    raise ValueError('Config inode or bytes changed during quarantine.')
            else:
                owner = os.fstat(parent)
                os.fchown(handle.fileno(), owner.st_uid, owner.st_gid)
            try:
                write_config(handle, operation['after'])
            except OSError:
                if info is None:
                    os.unlink(name, dir_fd=parent)
                else:
                    write_config(handle, operation['before'])
                raise

    def report(self):
        return {'context': self.label, 'backup': str(self.backup) if self.backup else None,
                'findings': [{k: op[k] for k in ('path', 'action', 'applied') if k in op} for op in self.operations],
                'error': self.error}


def write_config(handle, data):
    handle.seek(0)
    handle.write(data)
    handle.truncate()
    handle.flush()
    os.fsync(handle.fileno())


def plan_scopes(contexts, policy):
    protected = set()
    for _, root, kind in contexts:
        if kind != 'user':
            continue
        for path in PROTECTED:
            with at_path(root, path) as (parent, name):
                info = info_at(parent, name) if parent is not None else None
                if info:
                    protected.add(identity(info))
                    if stat.S_ISLNK(info.st_mode):
                        try:
                            protected.add(identity(os.stat(name, dir_fd=parent)))
                        except FileNotFoundError:
                            pass
    plans = []
    planned = {}
    for label, root, kind in contexts:
        plan = Plan(label, root, policy, protected)
        try:
            plan.user() if kind == 'user' else plan.system(kind)
            for operation in list(plan.operations):
                # A single-file bind can expose one config in two scopes.
                # Reconcile the inode once, or refuse conflicting edits.
                path = operation['path']
                with at_path(root, path) as (parent, name):
                    if operation['action'] == 'config' and operation['revision']:
                        key = ('config', *operation['revision'][:2])
                    elif parent is not None:
                        key = ('path', *identity(os.fstat(parent)), name)
                    else:
                        continue
                if key in planned:
                    if planned[key].get('after') != operation.get('after'):
                        raise ValueError('Conflicting edits to shared global configuration.')
                    plan.operations.remove(operation)
                else:
                    planned[key] = operation
        except (OSError, ValueError, RecursionError, TypeError):
            plan.error = 'Could not safely plan this scope. Check config syntax, aliases and mounts.'
        plans.append(plan)
    return plans


def scopes(stack, rootfs):
    def directory(base, relative):
        fd = os.open(base, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with at_path(fd, relative) as (parent, name):
                if parent is None or info_at(parent, name) is None:
                    return None
                child = os.open(name, DIRECTORY, dir_fd=parent)
                stack.callback(os.close, child)
                return child
        finally:
            os.close(fd)

    result = []
    seen = set()
    for label, base, relative, kind, optional in (
        ('bot-user', rootfs, 'home/box', 'user', False),
        ('bot-root', rootfs, 'root', 'user', True),
        ('host-root', '/', 'root', 'user', True),
        ('bot-system-codex', rootfs, 'etc/codex', 'codex', False),
        ('bot-system-claude', rootfs, 'etc/claude-code', 'claude', False),
        ('host-system-codex', '/', 'etc/codex', 'codex', False),
        ('host-system-claude', '/', 'etc/claude-code', 'claude', False),
    ):
        root = directory(base, relative)
        if root is None:
            if label == 'bot-user':
                raise ValueError('Missing bot-user home.')
            continue
        if optional and not any(info_at(root, name) for name in TOOL_HOME_NAMES + HOME_INSTRUCTIONS):
            continue
        key = identity(os.fstat(root))
        if key not in seen:
            seen.add(key)
            result.append((label, root, kind))
    return result


def validate_environment(container):
    env = dict(item.split('=', 1) for item in container['Config'].get('Env') or [] if '=' in item)
    defaults = {'HOME': '/home/box', 'CODEX_HOME': '/home/box/.codex', 'CLAUDE_CONFIG_DIR': '/home/box/.claude'}
    if any(env.get(key) not in (None, '', value) for key, value in defaults.items()) or any(env.get(key) for key in EXTENSION_ENV if key not in defaults):
        raise ValueError('The deployment redirects conventional global tool state.')


def validate_mounts(container):
    mounts = [(PurePosixPath(mount['Destination']), PurePosixPath(mount['Source']))
              for mount in container.get('Mounts', []) if mount.get('Source')]
    protected = []
    for home in (PurePosixPath('/home/box'), PurePosixPath('/root')):
        for relative in PROTECTED:
            path = home / relative
            protected.append(path)
            for destination, source in mounts:
                if path.is_relative_to(destination):
                    protected.append(source / path.relative_to(destination))
    for destination, source in mounts:
        is_tool_config = destination.name.endswith(('.json', '.toml')) or destination.name in (
            '.codex', '.claude', '.agents', 'codex', 'claude-code')
        if is_tool_config and not any(destination.is_relative_to(path) for path in protected) and any(
            source.is_relative_to(path) for path in protected
        ):
            raise ValueError('A global tool mount aliases protected credentials or task state.')


def run(name, policy, apply):
    with deployment_root(name) as (container, rootfs, _, recheck), ExitStack() as stack:
        validate_environment(container)
        validate_mounts(container)
        contexts = scopes(stack, rootfs)
        plans = plan_scopes(contexts, policy)
        if apply and not any(plan.error for plan in plans) and any(plan.operations for plan in plans):
            quarantine = private_directory(STATE / 'quarantine')
            backup = Path(tempfile.mkdtemp(prefix=name + '-', dir=quarantine))
            for plan in plans:
                plan.prepare(backup)
            for plan in plans:
                try:
                    plan.verify_all()
                except (OSError, ValueError):
                    plan.error = 'Global state changed after planning. No changes were applied.'
                    break
            for plan in plans:
                if any(item.error for item in plans):
                    break
                try:
                    recheck()
                    plan.apply()
                except (OSError, ValueError, RecursionError):
                    plan.error = 'Quarantine stopped. Review the findings and retained backup.'
                    break
        recheck()
        remaining = plan_scopes(contexts, policy) if apply else plans
        clean = not any(plan.operations or plan.error for plan in remaining) and not any(plan.error for plan in plans)
        return {'applied': apply, 'clean': clean, 'contexts': [plan.report() for plan in plans],
                'remaining': [plan.report() for plan in remaining] if apply else None}


def main():
    parser = argparse.ArgumentParser(prog='hive-manager deploy global-tools', description=__doc__)
    parser.add_argument('--container', required=True, help=argparse.SUPPRESS)
    parser.add_argument('--policy', required=True, metavar='FILE', help='Deployment JSON MCP allowlist on the Docker host')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true', help='Quarantine unwanted global extensions')
    mode.add_argument('--dry-run', action='store_true', help='Audit without file changes (default)')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run as root on the selected Linux Docker host.')
    try:
        policy = load_policy(args.policy)
        with maintenance_lock('global-tools') if args.apply else nullcontext():
            report = run(args.container, policy, args.apply)
        print(json.dumps(report, indent=2))
        return int(not report['clean'])
    except (OSError, ValueError, KeyError, TypeError, RecursionError):
        print('Could not safely read the deployment policy, inspect the deployment, or prepare quarantine.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
