/** Run the actual nested local-action loader and default resolver with bounded Node memory. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const path = 'experiments/issue-2323/probe-shared-actions.yml';
writeFileSync(
  path,
  `name: Shared action runtime probe
on: workflow_dispatch
jobs:
  resolver:
    runs-on: ubuntu-24.04
    steps:
      - id: gh
        uses: ./.github/actions/resolve-github-token
        with:
          default-token: \${{ secrets.PROBE_TOKEN }}
      - env:
          LAYER: \${{ steps.gh.outputs.layer }}
          TRIGGERS: \${{ steps.gh.outputs.triggers-workflows }}
          CREATE: \${{ steps.gh.outputs.can-create-repositories }}
        run: test "$LAYER/$TRIGGERS/$CREATE" = default/false/false
`
);
try {
  const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  const result = spawnSync(process.env.ACT_BINARY || '/tmp/issue-2323-tools/act', ['workflow_dispatch', '--bind', '-W', path, '-j', 'resolver', '-P', 'ubuntu-24.04=catthehacker/ubuntu:act-latest', '--env', 'NODE_OPTIONS=--max-old-space-size=256', '-s', 'PROBE_TOKEN'], { encoding: 'utf8', env: { ...process.env, PROBE_TOKEN: token }, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  process.stdout.write(`${result.stdout || ''}${result.stderr || ''}`.replaceAll(token, '[MASKED]'));
  assert.equal(result.status, 0, 'runtime staging and nested composite action must succeed');
} finally {
  rmSync(path, { force: true });
}
