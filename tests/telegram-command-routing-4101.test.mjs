// @hive-mind-test-suite default

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { installTelegramCommandRouting, TELEGRAM_ROUTING_UPDATES } from '../src/telegram-command-routing.lib.mjs';

const forum = { id: -10001, type: 'supergroup', is_forum: true };
const group = { id: -10002, type: 'group' };
const dm = { id: 200, type: 'private' };
const primary = { id: 10, is_bot: true, username: 'SwarmMindBot', first_name: 'Hive Mind' };
const secondary = { id: 11, is_bot: true, username: 'build_helper_bot', first_name: 'Hive Mind (Build)' };
const unrelated = { id: 12, is_bot: true, username: 'weather_bot', first_name: 'Weather' };
const human = { id: 13, is_bot: false, username: 'hivemind_fan', first_name: 'Hive Mind' };
const member = (user, status = 'member', extra = {}) => ({ status, user, ...extra });

function start(botInfo, callApi, options = {}) {
  let route;
  installTelegramCommandRouting({ use: handler => (route = handler) }, options);
  return async (chat, update) => {
    const ctx = { chat, update, message: update.message, botInfo, me: botInfo.username, telegram: { callApi } };
    let nextCalls = 0;
    await route(ctx, () => nextCalls++);
    assert.ok(nextCalls <= 1);
    return nextCalls === 1;
  };
}

function command(text, { entity = text.split(/\s/u)[0], threadId } = {}) {
  return { message: { text, entities: entity ? [{ type: 'bot_command', offset: 0, length: entity.length }] : [], message_thread_id: threadId } };
}

function telegramFixture() {
  const chats = new Map();
  const calls = [];
  const callApi = async (method, params, { signal }) => {
    calls.push({ method, params });
    assert.ok(signal instanceof AbortSignal);
    const members = chats.get(params.chat_id) ?? [];
    if (method === 'getChatAdministrators') {
      assert.equal(params.return_bots, true);
      return members.filter(peer => peer.status === 'administrator' || peer.status === 'creator');
    }
    assert.equal(method, 'getChatMember');
    const peer = members.find(({ user }) => user.id === params.user_id);
    if (!peer) throw new Error('Telegram does not know this user');
    return peer;
  };
  return { chats, calls, callApi };
}

test('bare and addressed commands work for a solo Hive Mind bot, including with unrelated bot administrators', async () => {
  const { chats, calls, callApi } = telegramFixture();
  chats.set(group.id, [member(primary, 'administrator'), member(unrelated, 'administrator'), member(human, 'creator')]);
  const dispatch = start(primary, callApi);
  assert.equal(await dispatch(group, command('/help')), true);
  assert.equal(await dispatch(group, command('/do a-target', { entity: null })), true);
  const lookups = calls.length;
  assert.equal(await dispatch(group, command('/help@sWaRmMiNdBoT')), true);
  assert.equal(await dispatch(group, command('/do@SwarmMindBot a-target', { entity: null })), true);
  assert.equal(await dispatch(group, command('/help@weather_bot')), false);
  assert.equal(await dispatch(group, { callback_query: { data: 'a-button' } }), true);
  assert.equal(await dispatch(group, { message: { text: 'normal conversation' } }), true);
  assert.equal(await dispatch(dm, command('/version')), true);
  assert.equal(calls.length, lookups);
});

test('two distinct Hive Mind administrators ignore every bare command and only the addressed bot handles a command', async () => {
  const { chats, callApi } = telegramFixture();
  chats.set(forum.id, [member(primary, 'administrator'), member(secondary, 'administrator')]);
  const bots = [start(primary, callApi), start(secondary, callApi)];
  const deliveries = update => Promise.all(bots.map(dispatch => dispatch(forum, update)));
  for (const [name, entity] of [
    ['/solve example', '/solve'],
    ['/codex example', null],
    ['/help', '/help'],
    ['/version', '/version'],
    ['/limits', '/limits'],
    ['/subscribe', '/subscribe'],
  ]) {
    assert.deepEqual(await deliveries(command(name, { entity, threadId: 321 })), [false, false], name);
  }
  assert.deepEqual(await deliveries(command('/help@SwarmMindBot', { threadId: 654 })), [true, false]);
  assert.deepEqual(await deliveries(command('/do@BUILD_HELPER_BOT example', { entity: null })), [false, true]);
  assert.deepEqual(await deliveries(command('/solve@weather_bot example', { entity: '/solve' })), [false, false]);
  assert.deepEqual(await deliveries(command('/help!unexpected', { entity: '/help' })), [false, false]);

  chats.set(forum.id, [member(primary, 'administrator'), member(secondary, 'left')]);
  assert.equal(await bots[0](forum, command('/help')), true);
});

test('ordinary peers learned from service and chat_member updates are scoped to their chat and survive restart', async t => {
  const stateDir = mkdtempSync(join(tmpdir(), 'hive-telegram-routing-'));
  t.after(() => rmSync(stateDir, { recursive: true, force: true }));
  const { chats, callApi } = telegramFixture();
  let dispatch = start(primary, callApi, { stateDir });
  assert.equal(await dispatch(group, command('/help')), true);

  chats.set(group.id, [member(secondary)]);
  await dispatch(group, { message: { new_chat_members: [secondary] } });
  assert.equal(await dispatch(group, command('/help')), false);
  assert.equal(await dispatch(forum, command('/help')), true);

  dispatch = start(primary, callApi, { stateDir });
  assert.equal(await dispatch(group, command('/help')), false);
  await dispatch(forum, { message: { migrate_from_chat_id: group.id } });
  chats.set(forum.id, [member(secondary)]);
  assert.equal(await dispatch(forum, command('/help')), false);

  await dispatch(group, { message: { left_chat_member: secondary } });
  await dispatch(forum, { chat_member: { new_chat_member: member(secondary, 'left') } });
  assert.equal(await dispatch(group, command('/help')), true);
  assert.equal(await dispatch(forum, command('/help')), true);

  await dispatch(forum, { chat_member: { new_chat_member: member(secondary) } });
  assert.equal(await dispatch(forum, command('/help')), false);
  const differentBot = start(unrelated, callApi, { stateDir });
  assert.equal(await differentBot(forum, command('/help')), true, 'another bot must not load the first bot’s local observations');
  assert.ok(TELEGRAM_ROUTING_UPDATES.includes('chat_member'));
});

test('configured IDs detect ordinary peers with custom names and follow their current membership', async () => {
  const { chats, callApi } = telegramFixture();
  chats.set(group.id, [member(unrelated, 'restricted', { is_member: true })]);
  const dispatch = start(primary, callApi, {
    configuredPeers: [
      { source: group.id, target: unrelated.id },
      { source: group.id, target: primary.id },
    ],
  });
  assert.equal(await dispatch(group, command('/limits')), false);
  assert.equal(await dispatch(forum, command('/limits')), true);
  chats.set(group.id, [member(unrelated, 'restricted', { is_member: false })]);
  assert.equal(await dispatch(group, command('/limits')), true);
  chats.set(group.id, []);
  assert.equal(await dispatch(group, command('/limits')), false, 'an API failure cannot prove a configured peer is absent');
});

test('a join during a shared membership read blocks bare commands in that polling batch', async () => {
  let complete;
  let requests = 0;
  const dispatch = start(primary, () => {
    requests++;
    return new Promise(resolve => (complete = resolve));
  });
  const first = dispatch(group, command('/help'));
  const second = dispatch(group, command('/version'));
  assert.equal(requests, 1);
  await dispatch(group, { message: { new_chat_members: [secondary] } });
  complete([]);
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
});

test('a failed Telegram discovery read suppresses bare commands while explicit commands and DMs still work', async () => {
  const dispatch = start(primary, () => {
    throw new Error('Telegram unavailable');
  });
  assert.equal(await dispatch(group, command('/help')), false);
  assert.equal(await dispatch(group, command('/help@SwarmMindBot')), true);
  assert.equal(await dispatch(dm, command('/start')), true);
});

test('the running bot gates Telegraf commands and entity-less fallback before dispatch', { timeout: 30_000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'hive-telegram-routing-bot-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const inputs = [
    [forum, command('/help')],
    [forum, command('/do', { entity: null })],
    [forum, command('/help@hive_test_bot')],
    [group, command('/do@hive_test_bot', { entity: null })],
  ];
  const batches = inputs.map(([chat, update], index) => ({
    atMs: index * 20,
    updates: [{ update_id: index + 1, message: { ...update.message, chat, from: human, message_id: index + 1 } }],
  }));
  const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./fixtures/issue-3206/telegraf-harness.mjs', import.meta.url)), fileURLToPath(new URL('../src/telegram-bot.mjs', import.meta.url)), '--isolation', '', '--no-solve', '--no-auto-close-linked-issues'], {
    cwd: home,
    env: {
      HOME: home,
      PATH: process.env.PATH,
      TELEGRAM_BOT_TOKEN: '4101:test-token',
      HIVE_HARNESS_BATCHES: JSON.stringify(batches),
      HIVE_HARNESS_ADMINISTRATORS: JSON.stringify({ [forum.id]: [member(secondary, 'administrator')], [group.id]: [member(secondary, 'administrator')] }),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const closed = once(child, 'close');
  const stop = () => child.kill('SIGKILL');
  t.signal.addEventListener('abort', stop, { once: true });
  let output = '';
  child.stdout.on('data', chunk => (output += chunk));
  child.stderr.on('data', chunk => (output += chunk));
  const replies = new Map();
  let batch;
  let finished = false;
  child.on('message', event => {
    if (event.type === 'batch') batch = event.index;
    if (event.type === 'api' && event.method === 'sendMessage') {
      replies.set(batch, (replies.get(batch) ?? 0) + 1);
      if (batch === inputs.length - 1) {
        finished = true;
        stop();
      }
    }
  });
  await closed;
  assert.ok(finished, output);
  assert.deepEqual([...replies.keys()], [2, 3], output);
  assert.equal(replies.get(3), 1, output);
  assert.equal(output.match(/Command \/do matched by text fallback/g)?.length, 1, output);
});
