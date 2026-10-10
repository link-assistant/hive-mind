#!/usr/bin/env node
/**
 * Issue #2998 (review on PR #2999): a script records the access guide on the
 * real github.com page with the same overlay as the replica. Here it drives a
 * fake page: which elements it looks for, what it clicks and types, and that
 * the invitation is only sent when asked.
 *
 * Run with: node tests/github-access-recorder-2998.test.mjs
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAccessAnimationCaptions } from '../src/github-access-animation.lib.mjs';
import { buildRecorderMockPage, cursorPath, findTarget, getRecorderSteps, PENDING_TARGETS, recordAccessGuide } from '../scripts/record-github-access-guide.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

// A page where `visible` selectors resolve to a box; records clicks, typing and overlay frames.
function fakePage(visible) {
  const events = [];
  const overlays = [];
  let installed = false;
  const page = {
    events,
    overlays,
    viewportSize: () => ({ width: 1000, height: 600 }),
    locator: selector => {
      const locator = {
        first: () => locator,
        isVisible: async () => selector in visible,
        boundingBox: async () => visible[selector],
        scrollIntoViewIfNeeded: async () => {},
        click: async () => events.push(`click ${selector}`),
      };
      return locator;
    },
    keyboard: { type: async text => events.push(`type ${text}`) },
    evaluate: async (fn, arg) => {
      if (arg?.css) {
        installed = true;
        return undefined;
      }
      if (!installed) return false;
      overlays.push(JSON.parse(JSON.stringify(arg)));
      return true;
    },
  };
  return page;
}

const box = (x, y) => ({ x, y, width: 80, height: 30 });
const realPage = login => ({
  'nav a[href$="/settings/access"]': box(20, 200),
  'role=button[name="Add people"]': box(700, 300),
  'role=dialog >> input[placeholder*="username" i]': box(300, 250),
  [`role=dialog >> role=option[name=/${login}/i]`]: box(300, 300),
  'role=dialog >> role=radio[name=/^Write/]': box(300, 380),
  'role=dialog >> role=button[name=/^Add .+ to /]': box(300, 500),
  'text=/Pending invite/i': box(300, 420),
});

await test('steps: the personal flow has no role; the organization flow picks Write', () => {
  assert.deepEqual(
    getRecorderSteps({ login: 'konard', ownerType: 'User' }).map(step => step.id),
    ['open', 'add', 'search', 'select', 'confirm']
  );
  const organization = getRecorderSteps({ login: 'konard', ownerType: 'Organization' });
  assert.deepEqual(
    organization.map(step => step.id),
    ['open', 'add', 'search', 'select', 'role', 'confirm']
  );
  assert.equal(organization.find(step => step.id === 'search').type, 'konard');
  assert.equal(organization.find(step => step.id === 'confirm').click, 'invite');
  assert.ok(getRecorderSteps({ login: 'a.b', ownerType: 'User' })[3].targets[0].includes('a\\.b'), 'login is a literal in name patterns');
});

await test('cursorPath eases from the start to exactly the target', () => {
  const path = cursorPath({ x: 0, y: 0 }, { x: 100, y: 50 }, 4);
  assert.equal(path.length, 4);
  assert.deepEqual(path.at(-1), { x: 100, y: 50 });
  assert.ok(path[0].x < 25 && path[1].x === 50, `eased: ${JSON.stringify(path)}`);
});

await test('findTarget takes the first visible selector and names all of them when none shows up', async () => {
  const page = fakePage({ b: box(0, 0) });
  const found = await findTarget(page, ['a', 'b']);
  assert.deepEqual(await found.boundingBox(), box(0, 0));
  let sleeps = 0;
  await assert.rejects(
    findTarget(page, ['x', 'y'], {
      timeoutMs: 0,
      sleep: async () => sleeps++,
    }),
    /none of these is visible: x \| y/
  );
});

for (const [ownerType, sendInvite] of [
  ['User', false],
  ['Organization', false],
  ['Organization', true],
]) {
  await test(`records the ${ownerType} flow${sendInvite ? ' and sends the invitation when asked' : ' without sending the invitation'}`, async () => {
    const page = fakePage(realPage('konard'));
    const captions = await buildAccessAnimationCaptions({ login: 'konard', ownerType, locale: 'en' });
    let shotCount = 0;
    const shots = await recordAccessGuide({ page, login: 'konard', ownerType, captions, sendInvite, screenshot: async () => Buffer.from([shotCount++]) });
    const clicks = page.events.filter(event => event.startsWith('click'));
    assert.deepEqual(clicks, ['click role=button[name="Add people"]', 'click role=dialog >> input[placeholder*="username" i]', 'click role=dialog >> role=option[name=/konard/i]', ...(ownerType === 'User' ? [] : ['click role=dialog >> role=radio[name=/^Write/]']), ...(sendInvite ? ['click role=dialog >> role=button[name=/^Add .+ to /]'] : [])]);
    assert.deepEqual(
      page.events.filter(event => event.startsWith('type')),
      ['k', 'o', 'n', 'a', 'r', 'd'].map(ch => `type ${ch}`),
      'typed one key at a time'
    );
    assert.equal(shots.length, page.overlays.length, 'one screenshot per overlay frame');
    assert.ok(shots.every(shot => shot.delay === 10));
    const shownCaptions = [...new Set(page.overlays.map(frame => frame.caption))];
    const expected = ['open', 'add', 'search', 'select', ...(ownerType === 'User' ? [] : ['role']), 'confirm', ...(sendInvite ? ['pending'] : [])];
    assert.deepEqual(
      shownCaptions,
      expected.map(id => captions[id])
    );
    const last = page.overlays.at(-1);
    const target = sendInvite ? box(300, 420) : box(300, 500);
    assert.deepEqual(last.cursor, { x: target.x + 40, y: target.y + 15 }, 'the cursor ends on the last target');
    assert.deepEqual(last.ring, { x: target.x - 4, y: target.y - 4, width: 88, height: 38 });
    assert.ok(
      page.overlays.some(frame => frame.ripple),
      'clicks show a ripple'
    );
  });
}

await test('a missing control fails with the step name', async () => {
  const visible = realPage('konard');
  delete visible['role=button[name="Add people"]'];
  const page = fakePage(visible);
  const captions = await buildAccessAnimationCaptions({ login: 'konard', ownerType: 'User', locale: 'en' });
  await assert.rejects(recordAccessGuide({ page, login: 'konard', ownerType: 'User', captions, screenshot: async () => Buffer.alloc(0), find: { timeoutMs: 0 } }), /step "add": none of these is visible/);
  assert.ok(PENDING_TARGETS.length > 0);
});

await test('the mock page has the roles and labels the selectors expect, with the login escaped', () => {
  const html = buildRecorderMockPage({ login: 'konard', ownerType: 'Organization' });
  for (const text of ['href="/your-account/your-repo/settings/access"', '>Add people<', 'placeholder="Search by username, full name, or email"', 'value="Write"', '>Add konard to your-repo<', 'Pending invite']) assert.ok(html.includes(text), text);
  assert.ok(!buildRecorderMockPage({ login: 'konard', ownerType: 'User' }).includes('value="Write"'));
  const hostile = buildRecorderMockPage({ login: '</script><img>', ownerType: 'User' });
  assert.equal(hostile.match(/<\/script>/g).length, 1, 'no early end of the script');
  assert.ok(!hostile.includes('<img>'));
});

await test('the CLI never invites without --send-invite and validates its input', async () => {
  const source = await readFile(new URL('../scripts/record-github-access-guide.mjs', import.meta.url), 'utf8');
  assert.match(source, /sendInvite: flag\('send-invite'\)/);
  assert.match(source, /bypassCSP: true/);
  assert.match(source, /colorScheme: 'dark'/);
  assert.match(source, /\^\[A-Za-z0-9-\]\+/);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
