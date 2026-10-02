// Run from the repository root with Bun. This packs the current Agent source,
// installs it in fresh projects, and runs the real bash tool tests with each
// parser version. The 0.27 peer conflict remains expected until OpenTUI upgrades.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'agent-tree-sitter-'));
const versions = process.argv.slice(2);
if (versions.length === 0) {
  versions.push('0.25.10', '0.27.0');
}

const run = (command, args, cwd, allowFailure = false) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (!allowFailure) {
    assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
  }
  return result;
};

try {
  for (const version of versions) {
    const source = join(workspace, `source-${version}`);
    mkdirSync(source);
    cpSync(join(root, 'js', 'src'), join(source, 'src'), { recursive: true });
    for (const file of ['README.md', 'LICENSE']) {
      copyFileSync(join(root, 'js', file), join(source, file));
    }
    const manifest = JSON.parse(readFileSync(join(root, 'js', 'package.json')));
    manifest.dependencies['web-tree-sitter'] = version;
    writeFileSync(join(source, 'package.json'), JSON.stringify(manifest));
    const packed = spawnSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', workspace],
      { cwd: source, encoding: 'utf8' }
    );
    assert.equal(packed.status, 0, packed.stderr);
    // npm 12 keys pack results by name; earlier npm releases return an array.
    const tarball = join(
      workspace,
      Object.values(JSON.parse(packed.stdout))[0].filename
    );
    const fixture = join(workspace, version);
    mkdirSync(fixture);
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({
        name: 'agent-bash-parser-probe',
        private: true,
        type: 'module',
        dependencies: { '@link-assistant/agent': `file:${tarball}` },
      })
    );
    console.log(`\nPacked Agent with web-tree-sitter@${version}`);
    const installed = run('bun', ['install', '--ignore-scripts'], fixture);
    const peers = run('npm', ['ls', 'web-tree-sitter', '--all'], fixture, true);
    if (version === '0.25.10') {
      assert.doesNotMatch(installed.stderr, /incorrect peer dependency/);
      assert.equal(peers.status, 0, 'the pinned package must have valid peers');
    } else {
      assert.ok(
        installed.stderr.includes(
          `incorrect peer dependency "web-tree-sitter@${version}"`
        ),
        'the newer runtime must reproduce the OpenTUI peer warning'
      );
      assert.notEqual(peers.status, 0, 'OpenTUI still requires the older peer');
      assert.match(peers.stderr, /invalid: web-tree-sitter@/);
    }
    const agent = join(fixture, 'node_modules', '@link-assistant', 'agent');
    mkdirSync(join(agent, 'tests'));
    copyFileSync(
      join(root, 'js', 'tests', 'tool_bash.js'),
      join(agent, 'tests', 'tool_bash.js')
    );
    run('bun', ['test', '--timeout', '30000', './tests/tool_bash.js'], agent);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
