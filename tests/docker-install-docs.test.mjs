/**
 * @hive-mind-test-suite default
 * Regression coverage for the Docker installation recipes in issue #1854.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const files = ['README.md', 'README.zh.md', 'README.hi.md', 'README.ru.md', 'docs/DOCKER.md', 'docs/DOCKER.zh.md', 'docs/DOCKER.hi.md', 'docs/DOCKER.ru.md'];
const upstreamUsage = 'https://github.com/link-foundation/box/blob/main/docs/dind/USAGE.md';

for (const file of files) {
  const content = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const blocks = [...content.matchAll(/```bash\n([\s\S]*?)```/g)].map(match => match[1]);
  const commands = blocks.join('\n').replace(/\\\n\s*/g, ' ');

  test(`${file}: Docker recipes use image users and the canonical GitHub setup`, () => {
    assert.doesNotMatch(commands, /docker run[^\n]*--user(?:=|\s)/);
    assert.match(commands, /^gh-setup-git-identity$/m);
    assert.doesNotMatch(commands, /^gh auth login /m);
    assert.match(commands, /docker pull konard\/hive-mind-dind:latest/);
    assert.match(commands, /docker run[^\n]*--privileged[^\n]*konard\/hive-mind-dind:latest/);
  });

  if (file.startsWith('docs/')) {
    test(`${file}: dind deployment persists credentials and starts the bot`, () => {
      const production = commands.split('\n').find(line => line.startsWith('docker run -dit --privileged') && line.includes('start-bot.sh'));
      assert.ok(production, 'missing persistent dind deployment');
      assert.match(production, /--restart unless-stopped/);
      assert.match(production, /DIND_STORAGE_DRIVER=fuse-overlayfs/);
      assert.match(production, /DIND_WAIT_SECONDS=180/);
      for (const mount of ['claude:/home/box/.claude', 'codex:/home/box/.codex', 'agents:/home/box/.agents', 'claude.json:/home/box/.claude.json', 'gh:/home/box/.config/gh']) {
        assert.ok(production.includes(mount), `missing ${mount}`);
      }
      assert.match(commands, /docker exec hive-mind docker info/);
      assert.match(commands, /docker exec hive-mind docker ps/);
      assert.match(commands, /docker logs hive-mind/);
      assert.ok(content.includes('/var/log/dockerd.log'));
      assert.ok(content.includes(upstreamUsage));
    });

    test(`${file}: committing a setup container restores daemon startup`, () => {
      assert.match(commands, /docker run[^\n]*DIND_SKIP_DAEMON=1/);
      assert.match(commands, /docker commit --change 'ENV DIND_SKIP_DAEMON=0'/);
    });

    test(`${file}: readiness waits for Docker and reports failure after finite attempts`, () => {
      const readiness = blocks.join('\n').match(/ready=0[\s\S]*?docker exec hive-mind docker ps/)?.[0];
      assert.ok(readiness, 'missing bounded daemon readiness check');
      for (const [readyAfter, expectedStatus] of [
        [3, 0],
        [181, 1],
      ]) {
        const result = spawnSync(
          'bash',
          [
            '-c',
            `
attempts=0
docker() {
  if [ "$*" = "exec hive-mind docker info" ]; then
    attempts=$((attempts + 1))
    [ "$attempts" -ge "$READY_AFTER" ]
  else
    printf '%s\\n' "$*"
  fi
}
sleep() { :; }
${readiness}
printf 'attempts=%s\\n' "$attempts"
`,
          ],
          {
            encoding: 'utf8',
            env: { ...process.env, READY_AFTER: String(readyAfter) },
            timeout: 5000,
          }
        );
        assert.ifError(result.error);
        assert.equal(result.status, expectedStatus, result.stderr);
        if (expectedStatus === 0) {
          assert.match(result.stdout, /exec hive-mind docker ps/);
          assert.match(result.stdout, /attempts=3/);
          assert.doesNotMatch(result.stdout, /logs hive-mind/);
        } else {
          assert.match(result.stdout, /logs hive-mind/);
          assert.match(result.stdout, /DIND_LOG_FILE/);
          assert.doesNotMatch(result.stdout, /exec hive-mind docker ps/);
        }
      }
    });
  }

  for (const cli of ['claude', 'codex']) {
    test(`${file}: ${cli} smoke check requires a successful OK model response`, () => {
      const verification = blocks.join('\n').match(new RegExp(`^${cli}_reply=.*\\n\\s+test[^\\n]*`, 'm'))?.[0];
      assert.ok(verification, `missing ${cli} response verification`);
      assert.ok(verification.includes('reply with only OK'));
      if (cli === 'codex') {
        assert.ok(verification.includes('--skip-git-repo-check'));
        assert.ok(verification.includes('--model gpt-5.4-mini'));
      }

      // Execute the documented recipe with a CLI stub: zero exit status alone
      // must not accept a trust refusal, quota message or missing model reply.
      for (const [response, status, expected] of [
        ['OK', 0, 0],
        ['Not inside a trusted directory and --skip-git-repo-check was not specified.', 0, 1],
        ["You've hit your weekly limit", 0, 1],
        ['', 0, 1],
        ['OK', 1, 1],
      ]) {
        const result = spawnSync('bash', ['-c', `${cli}() { printf '%s\\n' "$SMOKE_RESPONSE"; return "$SMOKE_STATUS"; }\n${verification}`], {
          encoding: 'utf8',
          env: { ...process.env, SMOKE_RESPONSE: response, SMOKE_STATUS: String(status) },
        });
        assert.ifError(result.error);
        assert.equal(result.status, expected, `${cli} output=${JSON.stringify(response)}, exit=${status}: ${result.stderr}`);
      }
    });
  }
}
