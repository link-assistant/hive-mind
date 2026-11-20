// @hive-mind-test-suite default

import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { installTelegramCommandRouting } from '../src/telegram-command-routing.lib.mjs';

const chat = { id: -100123, type: 'supergroup' };
const self = { id: 1, is_bot: true, username: 'project_agent_bot' };
const legacy = { id: 2, is_bot: true, username: 'ticket_helper_bot' };
const peer = { id: 3, is_bot: true, username: 'review_helper_bot' };
const human = { id: 4, is_bot: false };
const identityText = 'Hive Mind Telegram bot v2.45.0';
const seconds = () => Math.floor(Date.now() / 1000);

function fixture({ members, bot = self, administrators = [human], whoWaitMs = 80, versionWaitMs = 80 }) {
  const events = new EventEmitter();
  const sent = [];
  const handled = [];
  let serial = 0;
  let route;
  const newMessage = (from, text, extra = {}) => ({ chat, from, text, date: seconds(), message_id: ++serial, ...extra });
  const telegram = {
    async callApi(method, params) {
      assert.equal(params.chat_id, chat.id);
      if (method === 'getChatAdministrators') return administrators.filter(user => !user.is_bot || members.has(user.id)).map(user => ({ user, status: 'administrator' }));
      if (method === 'getChatMemberCount') return members.size + 2;
      if (method === 'getChatMember') return { status: members.has(params.user_id) ? 'member' : 'left', user: { id: params.user_id, is_bot: true } };
      assert.equal(method, 'sendMessage');
      const message = newMessage(bot, params.text);
      sent.push({ message, params });
      events.emit(params.text, message);
      return message;
    },
  };
  installTelegramCommandRouting({ telegram, use: handler => (route = handler) }, { identity: { getVersion: async () => '2.45.0', startedAt: seconds(), jitterMs: 0, whoWaitMs, versionWaitMs } });
  const update = (message, edited = false) => route({ message: edited ? undefined : message, chat, me: bot.username, botInfo: bot, telegram, update: { [edited ? 'edited_message' : 'message']: message } }, () => handled.push(message.text));
  const outgoing = async text => sent.find(event => event.message.text === text)?.message ?? (await once(events, text))[0];
  return { sent, handled, newMessage, update, outgoing };
}

test('two unlisted bots exchange identities before either handles their first bare command', { timeout: 5_000 }, async () => {
  const first = fixture({ members: new Set([peer.id]), whoWaitMs: 250 });
  const second = fixture({ bot: peer, members: new Set([self.id]), whoWaitMs: 250 });
  const work = first.newMessage(human, '/solve example');
  await Promise.all([first.update(work), second.update(work)]);
  const [firstProbe, secondProbe] = await Promise.all([first.outgoing('/who'), second.outgoing('/who')]);
  await Promise.all([first.update(secondProbe), second.update(firstProbe)]);
  const [firstReply, secondReply] = await Promise.all([first.outgoing(identityText), second.outgoing(identityText)]);
  await Promise.all([first.update({ ...secondReply, reply_to_message: firstProbe }), second.update({ ...firstReply, reply_to_message: secondProbe })]);

  const addressed = first.newMessage(human, '/solve@review_helper_bot example');
  await Promise.all([first.update(addressed), second.update(addressed)]);
  await delay(300);
  assert.ok(!first.handled.some(text => text.startsWith('/solve')));
  assert.deepEqual(
    second.handled.filter(text => text.startsWith('/solve')),
    [addressed.text]
  );
});

test('visible bots are challenged in their topic and a localized edited legacy report establishes identity', { timeout: 5_000 }, async () => {
  const { sent, handled, newMessage, update, outgoing } = fixture({ members: new Set([legacy.id]) });
  const topic = { message_thread_id: 31, is_topic_message: true };
  await update(newMessage(legacy, '/who@project_agent_bot', topic));
  const who = await outgoing('/who@ticket_helper_bot');
  assert.equal(sent[0].params.text, identityText);
  assert.equal(sent[0].params.reply_parameters.message_id, 1);
  assert.equal(sent[1].params.message_thread_id, 31);
  assert.equal(sent[1].params.disable_notification, true);

  // Echoing our own request and fabricating candidate replies are both ignored.
  await update(who);
  await update(newMessage(human, identityText, { reply_to_message: who }));
  await update(newMessage(legacy, identityText, { reply_to_message: { ...who, message_id: 900 } }));
  await update(newMessage(legacy, identityText, { reply_to_message: who, forward_origin: { type: 'user' } }));
  await update(newMessage(legacy, 'Our project is called Hive Mind'));
  const version = await outgoing('/version@ticket_helper_bot');
  const oldReply = newMessage(legacy, '🔄 Сбор информации о версии...', { reply_to_message: version });
  await update(oldReply);
  await update({ ...oldReply, text: '📦 Информация о версиях\n\n🤖 Hive-Mind\n• Версия: 2.39.10\n\n📦 JavaScript/Node.js\n• Node.js: 24.0.0' }, true);

  for (const text of ['/solve', '/help', '/limits', '/version', '/who']) await update(newMessage(human, text));
  await update(newMessage(human, '/solve@project_agent_bot'));
  assert.deepEqual(
    handled.filter(text => text.startsWith('/')),
    ['/solve@project_agent_bot']
  );
  assert.deepEqual(
    sent.map(event => event.params.text),
    [identityText, '/who@ticket_helper_bot', '/version@ticket_helper_bot']
  );
});

test('a previously answered peer is reused and a third bot is the only target', { timeout: 5_000 }, async () => {
  const members = new Set([peer.id, legacy.id]);
  const { sent, handled, newMessage, update, outgoing } = fixture({ members, administrators: [human, peer, legacy] });
  const otherRequest = newMessage(legacy, '/who@review_helper_bot');
  await update(newMessage(peer, identityText, { reply_to_message: otherRequest }));
  await update(newMessage(human, '/help'));
  const request = await outgoing('/who@ticket_helper_bot');
  await update(newMessage(legacy, identityText, { reply_to_message: request }));
  await delay(150);
  assert.deepEqual(
    sent.map(event => event.params.text),
    ['/who@ticket_helper_bot']
  );
  assert.ok(!handled.includes('/help'));

  members.delete(peer.id);
  members.delete(legacy.id);
  await update(newMessage(human, undefined, { left_chat_member: peer }));
  await update(newMessage(human, undefined, { left_chat_member: legacy }));
  await update(newMessage(human, '/help'));
  assert.ok(handled.includes('/help'));
});

test('an unrelated bot with no matching response leaves solo access intact', { timeout: 5_000 }, async () => {
  const { sent, handled, newMessage, update, outgoing } = fixture({ members: new Set([legacy.id]) });
  const ask = newMessage(legacy, '/version@project_agent_bot');
  await update(ask);
  await update(ask); // Telegram can redeliver an update.
  const who = await outgoing('/who@ticket_helper_bot');
  await update(newMessage(legacy, 'Weather Bot v1.0.0', { reply_to_message: who }));
  await update(newMessage(human, '/help'));
  const version = await outgoing('/version@ticket_helper_bot');
  await update(newMessage(legacy, 'Version: 2.45.0', { reply_to_message: version }));
  await delay(150);
  assert.ok(handled.includes('/help'));
  assert.deepEqual(
    sent.map(event => event.params.text),
    [identityText, '/who@ticket_helper_bot', '/version@ticket_helper_bot']
  );
});
