/**
 * Regression test for issue #1700.
 *
 * /log and /terminal_watch wrongly rejected real `$` isolation sessions with:
 *   "This command currently supports only sessions launched with `$` isolation
 *   (screen / tmux / docker)."
 *
 * Root cause: parseSessionStatusOutput looked for the isolation backend at
 *   - JSON: `data.isolation` or `data.options.isolation`
 *   - text/links-notation: a top-level `isolation` field
 * but the published `start-command` (link-foundation/start v0.25.x) actually
 * uses `options.isolated` in both JSON and links-notation output.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1700
 * @see https://github.com/link-foundation/start
 */

import { parseSessionStatusOutput } from '../src/isolation-runner.lib.mjs';
import { decideLogDestination } from '../src/telegram-log-command.lib.mjs';

let passed = 0;
let failed = 0;
function assertEqual(actual, expected, label) {
  if (actual === expected) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log('\n--- parseSessionStatusOutput() handles real start-command output ---');

// Real-world output from issue #1700, captured from `$ --status <uuid>` on a
// host running link-foundation/start. The default format is "links-notation"
// (indented uuid + nested options block with `isolated <backend>`).
const realLinksNotationOutput = `a1df7de8-1228-4730-9e1c-63b9beec5f48
  uuid a1df7de8-1228-4730-9e1c-63b9beec5f48
  status executed
  exitCode 0
  command "solve https://github.com/PavelChurkin/resource-based-economy-Article/issues/11 --think max --tool codex --attach-logs --verbose --no-tool-check"
  logPath /tmp/start-command/logs/isolation/screen/a1df7de8-1228-4730-9e1c-63b9beec5f48.log
  startTime "2026-04-26T20:45:55.964Z"
  endTime "2026-04-26T21:01:57.746Z"
  workingDirectory /home/box
  shell /bin/sh
  platform linux
  options
    isolated screen
    isolationMode detached
    sessionName f9838e46-7d7b-4d84-ad59-ff784668107a
    user false
    keepAlive false
    useCommandStream false
`;

const linksParsed = parseSessionStatusOutput(realLinksNotationOutput);
assertEqual(linksParsed.exists, true, 'links-notation: marks session as exists');
assertEqual(linksParsed.uuid, 'a1df7de8-1228-4730-9e1c-63b9beec5f48', 'links-notation: extracts uuid');
assertEqual(linksParsed.status, 'executed', 'links-notation: lowercases status');
assertEqual(linksParsed.exitCode, 0, 'links-notation: parses exitCode');
assertEqual(linksParsed.logPath, '/tmp/start-command/logs/isolation/screen/a1df7de8-1228-4730-9e1c-63b9beec5f48.log', 'links-notation: surfaces logPath');
assertEqual(linksParsed.isolation, 'screen', 'links-notation: surfaces options.isolated as isolation (issue #1700)');

// Real JSON output uses options.isolated (NOT options.isolation, NOT top-level isolation).
const realJsonOutput = JSON.stringify({
  uuid: 'a1df7de8-1228-4730-9e1c-63b9beec5f48',
  pid: null,
  status: 'executed',
  exitCode: 0,
  command: 'solve https://github.com/PavelChurkin/resource-based-economy-Article/issues/11 --think max --tool codex --attach-logs --verbose --no-tool-check',
  logPath: '/tmp/start-command/logs/isolation/screen/a1df7de8-1228-4730-9e1c-63b9beec5f48.log',
  startTime: '2026-04-26T20:45:55.964Z',
  endTime: '2026-04-26T21:01:57.746Z',
  workingDirectory: '/home/box',
  shell: '/bin/sh',
  platform: 'linux',
  options: {
    isolated: 'screen',
    isolationMode: 'detached',
    sessionName: 'f9838e46-7d7b-4d84-ad59-ff784668107a',
    image: null,
    endpoint: null,
    user: false,
    keepAlive: false,
    useCommandStream: false,
  },
});

const jsonParsed = parseSessionStatusOutput(realJsonOutput);
assertEqual(jsonParsed.exists, true, 'JSON: marks session as exists');
assertEqual(jsonParsed.isolation, 'screen', 'JSON: surfaces options.isolated as isolation (issue #1700)');

// Tmux JSON
const tmuxJsonOutput = JSON.stringify({
  uuid: 'b2cf8e57-2339-5841-ad60-9beec670fed2',
  status: 'running',
  options: { isolated: 'TMUX', isolationMode: 'detached' },
});
const tmuxParsed = parseSessionStatusOutput(tmuxJsonOutput);
assertEqual(tmuxParsed.isolation, 'tmux', 'JSON: tmux backend is lowercased from options.isolated');

// Docker JSON
const dockerJsonOutput = JSON.stringify({
  uuid: 'c3ef9e58-3340-6841-ad61-9cfeb780fed3',
  status: 'executing',
  options: { isolated: 'docker', isolationMode: 'detached' },
});
const dockerParsed = parseSessionStatusOutput(dockerJsonOutput);
assertEqual(dockerParsed.isolation, 'docker', 'JSON: docker backend surfaces from options.isolated');

console.log('\n--- decideLogDestination() accepts real isolation sessions ---');

// Reproducing exact decision flow used by /log and /terminal_watch with the
// real start-command output. Before the fix, decision.destination === "reject"
// because parseSessionStatusOutput returned isolation: null.
const decision = decideLogDestination({
  statusResult: linksParsed,
  sessionInfo: null,
  repoVisibility: { isPublic: true, visibility: 'public' },
  chatType: 'group',
});
assertEqual(decision.destination, 'chat', 'real screen session in public chat → chat (was rejected before fix)');
assertEqual(decision.isolationBackend, 'screen', 'decision exposes screen backend from options.isolated');

const decisionJson = decideLogDestination({
  statusResult: jsonParsed,
  sessionInfo: null,
  repoVisibility: { isPublic: true, visibility: 'public' },
  chatType: 'supergroup',
});
assertEqual(decisionJson.destination, 'chat', 'real JSON session in supergroup → chat (was rejected before fix)');
assertEqual(decisionJson.isolationBackend, 'screen', 'decision exposes screen backend from JSON options.isolated');

console.log(`\n================================================================================`);
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log(`================================================================================`);

if (failed > 0) process.exit(1);
