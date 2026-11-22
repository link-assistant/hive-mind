import copy
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest.mock import patch


source = Path(__file__).resolve().parents[3] / 'src/hive-manager/maintenance'
sys.path.insert(0, str(source))


def load(name):
    spec = importlib.util.spec_from_file_location(name, source / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


global_tools = load('global-tools')
services = load('tool-services')


class GlobalTools(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.home = self.root / 'home'
        self.home.mkdir()
        self.fd = os.open(self.home, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, self.fd)
        self.contexts = [('bot-user', self.fd, 'user')]
        self.policy = {'codexMcp': {'approved': {'command': 'fixture-mcp'}}}

    def write(self, relative, value):
        file = self.home / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(value)
        return file

    def plan(self):
        return global_tools.plan_scopes(self.contexts, self.policy)

    def test_preview_and_quarantine_preserve_auth_task_state_and_inode(self):
        original = """
model = "fixture-model"
[profiles.dev.plugins.unwanted]
enabled = true
[mcp_servers.approved]
command = "wrong-definition"
[mcp_servers.unapproved]
command = "unapproved-content"
"""
        config = self.write('.codex/config.toml', original)
        inode = config.stat().st_ino
        auth = self.write('.codex/auth.json', 'auth fixture')
        task = self.write('.codex/hive-mind/tasks/concurrent/.codex/config.toml', 'task fixture')
        rules = self.write('.codex/rules/default.rules', 'permission rules fixture')
        stock = self.write('.codex/skills/.system/skill-creator/SKILL.md', 'stock fixture')
        unexpected = self.write('.codex/skills/.system/unexpected/SKILL.md', 'extension fixture')
        extension = self.write('.claude/plugins/extension.json', 'extension fixture')
        link = self.home / '.codex/skills/link-to-task'
        link.symlink_to(task.parent, target_is_directory=True)
        claude = self.write('.claude.json', json.dumps({
            'oauthAccount': {'accountUuid': 'private fixture'},
            'mcpServers': {'unwanted': {'command': 'fixture'}},
            'projects': {'/task': {'mcpServers': {'task-local': {'command': 'fixture'}}}},
        }))
        before = json.loads(claude.read_text())
        plan, = self.plan()
        self.assertIsNone(plan.error)
        self.assertTrue(extension.is_file())
        self.assertEqual(config.read_text(), original)
        self.assertNotIn('private fixture', json.dumps(plan.report()))
        self.assertNotIn('wrong-definition', json.dumps(plan.report()))
        plan.prepare(self.root)
        plan.verify_all()
        plan.apply()
        self.assertEqual(config.stat().st_ino, inode)
        result = tomllib.loads(config.read_text())
        self.assertEqual(result['model'], 'fixture-model')
        self.assertEqual(result['mcp_servers'], self.policy['codexMcp'])
        self.assertFalse(result['features']['remote_plugin'])
        self.assertEqual(result['profiles'], {'dev': {}})
        self.assertEqual(auth.read_text(), 'auth fixture')
        self.assertEqual(task.read_text(), 'task fixture')
        self.assertEqual(rules.read_text(), 'permission rules fixture')
        self.assertTrue(stock.exists())
        self.assertFalse(unexpected.exists())
        self.assertFalse(extension.exists())
        self.assertFalse(link.is_symlink())
        self.assertEqual(json.loads(claude.read_text()), {**before, 'mcpServers': {}})
        self.assertEqual((plan.backup / 'config/.codex/config.toml').read_text(), original)
        self.assertEqual((plan.backup / 'removed/.claude/plugins/extension.json').read_text(), 'extension fixture')
        self.assertTrue((plan.backup / 'removed/.codex/skills/link-to-task').is_symlink())
        self.assertEqual(self.plan()[0].operations, [])

    def test_protected_hardlink_and_concurrent_config_change_stop_cleanup(self):
        auth = self.write('.codex/auth.json', '{}')
        config = self.home / '.codex/config.toml'
        os.link(auth, config)
        self.assertIsNotNone(self.plan()[0].error)
        config.unlink()
        config.write_text('model = "fixture"')
        plan, = self.plan()
        config.write_text('model = "changed"')
        with self.assertRaises(ValueError):
            plan.verify_all()
        self.assertEqual(auth.read_text(), '{}')

    def test_redirected_skill_directories_are_quarantined_without_traversing_them(self):
        task_skill = self.write('.codex/hive-mind/tasks/run/SKILL.md', 'task skill')
        for relative in ('.codex/skills', '.codex/skills/.system'):
            with self.subTest(relative=relative):
                link = self.home / relative
                link.parent.mkdir(parents=True, exist_ok=True)
                link.symlink_to(task_skill.parent, target_is_directory=True)
                plan, = self.plan()
                self.assertIsNone(plan.error)
                backup = Path(tempfile.mkdtemp(dir=self.root))
                plan.prepare(backup)
                plan.apply()
                self.assertFalse(link.is_symlink())
                self.assertTrue((plan.backup / 'removed' / relative).is_symlink())
                self.assertEqual(task_skill.read_text(), 'task skill')

    def test_claude_overrides_cannot_reenable_shared_extensions(self):
        for relative, kind in (('.claude/settings.local.json', 'user'), ('managed-settings.json', 'claude')):
            with self.subTest(relative=relative):
                file = self.write(relative, json.dumps({
                    'permissions': {'deny': ['Bash']},
                    'syncClaudeAiSkills': True,
                    'allowAllClaudeAiMcps': True,
                    'disableAllHooks': False,
                    'env': {'ENABLE_CLAUDEAI_MCP_SERVERS': 'true', 'CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL': '0'},
                }))
                plan, = global_tools.plan_scopes([('fixture', self.fd, kind)], self.policy)
                plan.prepare(Path(tempfile.mkdtemp(dir=self.root)))
                plan.apply()
                self.assertEqual(json.loads(file.read_text()), {
                    'permissions': {'deny': ['Bash']},
                    'syncClaudeAiSkills': False,
                    'allowAllClaudeAiMcps': False,
                    'disableAllHooks': True,
                    'env': {'ENABLE_CLAUDEAI_MCP_SERVERS': 'false', 'CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL': '1'},
                })

    def test_requirements_and_managed_configs_preserve_security_policy(self):
        file = self.write('requirements.toml', 'allowed_approval_policies = ["on-request"]\n[mcp_servers.approved]\ncommand = "pinned"\n[hooks]\nStop = []\n[config_server]\nurl = "https://config.invalid"\n')
        plan, = global_tools.plan_scopes([('system-codex', self.fd, 'codex')], self.policy)
        self.assertIsNone(plan.error)
        plan.prepare(self.root)
        plan.apply()
        result = tomllib.loads(file.read_text())
        self.assertEqual(result['allowed_approval_policies'], ['on-request'])
        self.assertEqual(result['mcp_servers'], {'approved': {'command': 'pinned'}})
        self.assertNotIn('hooks', result)
        self.assertNotIn('config_server', result)

    def test_mount_source_cannot_redirect_a_config_into_a_task_scope(self):
        with self.assertRaises(ValueError):
            global_tools.validate_mounts({'Mounts': [
                {'Destination': '/home/box/.codex', 'Source': '/fixture/state/codex'},
                {'Destination': '/home/box/.claude.json', 'Source': '/fixture/state/codex/hive-mind/tasks/config.json'},
            ]})


def process(pid, role, **changes):
    return {**dict(pid=pid, start=100 * pid, role=role, tool='codex', state='S', ppid=2,
                   tty=0, cgroup='root', executable='/tools/codex'), **changes}


def snapshot():
    return dict(identity=('id', 2, 5, 'root'), tasks=set(), processes={
        3: process(3, 'updater'),
        4: process(4, 'managed-daemon', ppid=3),
        5: process(5, 'managed-daemon', cgroup='/docker/task'),
    })


class ToolServices(unittest.TestCase):
    def test_known_signatures_and_unknown_modes(self):
        self.assertEqual(services.classify(['codex', 'app-server', 'daemon', 'pid-update-loop'], 'codex', '/tools/codex'), ('codex', 'updater'))
        self.assertEqual(services.classify(['claude', '--chrome-native-host'], 'claude', '/tools/claude'), ('claude', 'browser-helper'))
        for args, exe in [
            (['codex', 'login'], '/tools/codex'),
            (['codex', 'app-server'], '/tools/codex'),
            (['codex', 'app-server', 'unknown', '--managed-daemon'], '/tools/codex'),
            (['codex', 'app-server', '--managed-daemon'], '/tools/unexpected'),
            (['claude', '--print', '--chrome-native-host'], '/tools/claude'),
        ]:
            self.assertEqual(services.classify(args, args[0], exe), (args[0], 'foreground'))

    def test_preview_and_plan_protect_tasks_other_containers_and_foreground_work(self):
        with patch.object(services.os, 'pidfd_open') as opened:
            preview = services.cleanup(snapshot, ['codex'], False, False)
        self.assertEqual([item['pid'] for item in preview['plans'][0]['helpers']], [3, 4])
        opened.assert_not_called()
        for change in (
            lambda state: state['tasks'].add('codex'),
            lambda state: state['tasks'].add('unknown'),
            lambda state: state['processes'].update({6: process(6, 'foreground')}),
            lambda state: state['processes'][3].update(tty=10),
            lambda state: state['processes'][3].update(ppid=6),
            lambda state: state['processes'].update({6: process(6, None, tool=None, ppid=3)}),
            lambda state: state['processes'].update({6: process(6, None, tool=None, starting='unknown')}),
        ):
            state = snapshot()
            change(state)
            self.assertTrue(services.service_plan(state, 'codex', False)[1])

    def test_each_signal_rechecks_root_task_scope_and_process_incarnation(self):
        initial = snapshot()
        helper = initial['processes'][3]
        for sig in (signal.SIGTERM, signal.SIGKILL):
            for change in ('root', 'task', 'pid-reuse', 'executable', 'ok'):
                with self.subTest(sig=sig, change=change):
                    latest = copy.deepcopy(initial)
                    if change == 'root':
                        latest['identity'] = ('new-id', *latest['identity'][1:])
                    if change == 'task':
                        latest['tasks'].add('codex')
                    if change == 'pid-reuse':
                        latest['processes'][3]['start'] += 1
                    if change == 'executable':
                        latest['processes'][3]['executable'] = '/tools/changed'
                    with (patch.object(services.os, 'pidfd_open', return_value=42),
                          patch.object(services.os, 'close') as closed,
                          patch.object(services, 'read_process', return_value=latest['processes'][3]),
                          patch.object(services.signal, 'pidfd_send_signal') as sent):
                        if change == 'root':
                            with self.assertRaises(ValueError):
                                services.signal_helper(helper, sig, initial['identity'], lambda: latest, False)
                        else:
                            result = services.signal_helper(helper, sig, initial['identity'], lambda: latest, False)
                            self.assertEqual(result == 'signalled', change == 'ok')
                        if change == 'ok':
                            sent.assert_called_once_with(42, sig)
                        else:
                            sent.assert_not_called()
                        closed.assert_called_once_with(42)

    def test_preview_reads_custom_task_store_without_refreshing_stale_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / 'custom-registry'
            registry.mkdir()
            store = registry / 'executions.lino'
            cache = registry / 'executions.decoded.js.json'
            command = 'solve https://github.com/example/example/issues/1 --tool codex'
            source = json.dumps([{'status': 'executing', 'command': command}, {'status': 'executed', 'command': 'finished'}])
            stale = '{"format":"start-command-decoded-store-js-1","sha256":"stale","records":[]}'
            store.write_text(source)
            cache.write_text(stale)

            def read_as_box(*args, input):
                self.assertEqual(args[:5], ('exec', '--user', 'box', '-i', 'fixture'))
                return subprocess.check_output(
                    args[5:], text=True, input=input, env={**os.environ, 'START_APP_FOLDER': str(registry)}
                )

            with patch.object(services, 'docker', side_effect=read_as_box):
                self.assertEqual(services.current_records('fixture'), [{'command': command}])
                self.assertEqual(store.read_text(), source)
                self.assertEqual(cache.read_text(), stale)
                store.unlink()
                with self.assertRaises(subprocess.CalledProcessError):
                    services.current_records('fixture')
                cache.unlink()
                self.assertEqual(services.current_records('fixture'), [])


if __name__ == '__main__':
    unittest.main()
