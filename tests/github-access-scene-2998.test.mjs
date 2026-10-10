#!/usr/bin/env node
/**
 * Issue #2998 (review on PR #2999): the access animation is a replica of
 * GitHub's dark "Collaborators" page with a cursor driven by one CSS timeline,
 * written as an animated SVG and sampled into a GIF that stores only what
 * changes between frames.
 *
 * No browser needed: markup and keyframes are checked as text, the GIF
 * splicing with synthetic images.
 *
 * Run with: node tests/github-access-scene-2998.test.mjs
 */

import assert from 'node:assert/strict';
import { buildAccessAnimationCaptions } from '../src/github-access-animation.lib.mjs';
import { buildAccessAnimationHtml, buildAccessAnimationSvg, buildAccessScene, buildTimelineCss, createTimeline, getSceneTargets, identicon, SCENE_SIZE } from '../src/github-access-scene.lib.mjs';
import { buildPalette, cropImage, decodePng, diffBounds, encodeDiffGif, encodePng, readGifImage, snapToPalette, spliceGifFrames } from '../src/gif-frames.lib.mjs';
import { OCTICON_PATHS, octicon } from '../src/github-octicons.lib.mjs';

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

const escapeXml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
// Offset of the image descriptor after the n-th graphic control extension.
// Graphic control extensions: flags, delay (centiseconds) and transparent index.
const GCE = Buffer.from([0x21, 0xf9, 0x04]);
const readControls = gif => {
  const controls = [];
  for (let offset = gif.indexOf(GCE); offset >= 0; offset = gif.indexOf(GCE, offset + 1)) controls.push({ packed: gif[offset + 3], delay: gif.readUInt16LE(offset + 4), index: gif[offset + 6] });
  return controls;
};
const descriptorAt = (gif, n) => {
  let offset = -1;
  for (let i = 0; i <= n; i++) offset = gif.indexOf(Buffer.from([0x21, 0xf9, 0x04]), offset + 1);
  return offset + 8;
};
const captionsFor = (ownerType, locale = 'en', login = 'konard') => buildAccessAnimationCaptions({ login, ownerType, locale });

await test('timeline: layers, cursor path and clicks follow the calls', () => {
  const tl = createTimeline({ start: { x: 0, y: 0 } });
  tl.show('a', { fade: 0 }).wait(1).move({ x: 10, y: 20 }, 2).click().hide('a').show('b');
  const plan = tl.end(1);
  assert.equal(plan.duration, 4.35);
  assert.deepEqual(plan.layers.get('a'), [{ from: 0, to: 3.35, fade: 0 }]);
  assert.deepEqual(plan.layers.get('b'), [{ from: 3.35, to: 4.35, fade: 0.15 }], 'open layers close at the end');
  assert.deepEqual(plan.cursor, [
    { t: 0, x: 0, y: 0 },
    { t: 1, x: 0, y: 0 },
    { t: 3, x: 10, y: 20 },
    { t: 4.35, x: 10, y: 20 },
  ]);
  assert.deepEqual(plan.clicks, [{ t: 3, x: 10, y: 20 }]);
  const css = buildTimelineCss(plan);
  assert.match(css, /#hm-root #a\{animation:hm-a 4\.350s linear infinite\}/);
  assert.match(css, /@keyframes hm-a\{0%\{opacity:1\}77\.011%\{opacity:1;animation-timing-function:step-end\}77\.241%\{opacity:0\}100%\{opacity:0\}\}/, 'hiding is a hard cut');
  assert.match(css, /@keyframes hm-b\{0%\{opacity:0\}77\.011%\{opacity:0\}80\.460%\{opacity:1\}100%\{opacity:1\}\}/, 'fades are linear');
  assert.match(css, /@keyframes hm-cursor\{0\.000%\{transform:translate\(0px,0px\);animation-timing-function:ease-in-out\}22\.989%\{transform:translate\(0px,0px\);[^}]*\}68\.966%\{transform:translate\(10px,20px\)/);
  assert.match(css, /@keyframes hm-click-0\{/);
});

await test('both flows visit every control in order and end on the pending invitation', async () => {
  for (const ownerType of ['User', 'Organization']) {
    const { plan, duration } = buildAccessScene({ login: 'konard', ownerType, captions: await captionsFor(ownerType) });
    const targets = getSceneTargets({ ownerType });
    const inside = (point, box) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
    const order = ownerType === 'User' ? ['sidebar', 'addPeople', 'result', 'confirm'] : ['sidebar', 'addPeople', 'result', 'roleWrite', 'confirm'];
    assert.equal(plan.clicks.length, order.length, ownerType);
    plan.clicks.forEach((click, i) => assert.ok(inside(click, targets[order[i]]), `${ownerType}: click ${i} lands on ${order[i]}`));
    for (const box of Object.values(targets)) assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= SCENE_SIZE.width && box.y + box.height <= SCENE_SIZE.height, `${ownerType}: target inside the scene`);
    const pending = plan.layers.get('hm-pending')[0];
    assert.ok(duration - pending.from > 3, `${ownerType}: the result stays on screen`);
    const captionOrder = [...plan.layers.keys()].filter(id => id.startsWith('hm-caption-'));
    assert.deepEqual(captionOrder, ['hm-caption-open', 'hm-caption-add', 'hm-caption-search', 'hm-caption-select', ...(ownerType === 'User' ? [] : ['hm-caption-role']), 'hm-caption-confirm', 'hm-caption-pending']);
  }
});

await test('the replica shows the GitHub page for each owner kind, with the login typed in', async () => {
  const personal = buildAccessScene({ login: 'konard', ownerType: 'User', captions: await captionsFor('User') }).markup;
  assert.ok(personal.includes('github.com/your-account/your-repo/settings/access'));
  assert.ok(personal.includes('Who has access') && personal.includes('Add a collaborator to your-repo') && personal.includes('Add konard to your-repo'));
  assert.ok(!personal.includes('Choose a role'), 'personal collaborators have no role picker');
  const organization = buildAccessScene({ login: 'konard', ownerType: 'Organization', captions: await captionsFor('Organization') }).markup;
  assert.ok(organization.includes('Collaborators and teams') && organization.includes('Add people to your-repo') && organization.includes('Choose a role'));
  for (const role of ['Read', 'Triage', 'Write', 'Maintain', 'Admin']) assert.ok(organization.includes(`>${role}<`), role);
  for (let i = 1; i <= 'konard'.length; i++) assert.ok(organization.includes(`id="hm-typed-${i}"`) && organization.includes(`>${'konard'.slice(0, i)}<`), `typed ${i}`);
  const custom = buildAccessScene({ login: 'konard', ownerType: 'User', captions: await captionsFor('User'), owner: 'acme', repo: 'app' }).markup;
  assert.ok(custom.includes('github.com/acme/app/settings/access') && custom.includes('Add konard to app'));
});

await test('captions are on the page in the requested language', async () => {
  for (const locale of ['en', 'ru', 'zh', 'hi']) {
    const captions = await captionsFor('Organization', locale);
    const { markup } = buildAccessScene({ login: 'konard', ownerType: 'Organization', captions });
    for (const key of ['open', 'add', 'search', 'select', 'role', 'confirm', 'pending']) assert.ok(markup.includes(escapeXml(captions[key])), `${locale}: ${key}`);
    assert.ok(markup.includes(`lang="${locale}"`));
  }
});

await test('the SVG is one self-contained, escaped XML document', async () => {
  const captions = await captionsFor('User');
  const svg = buildAccessAnimationSvg({ login: 'a&b', ownerType: 'User', captions: { ...captions, title: '<script>x</script>', open: '"&<' }, repo: '<r>' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="960" height="640" viewBox="0 0 960 640" role="img" aria-label="&lt;script&gt;x&lt;\/script&gt;">/);
  assert.ok(svg.includes('<foreignObject') && svg.includes('<div xmlns="http://www.w3.org/1999/xhtml" id="hm-root"'));
  assert.ok(!svg.includes('<script') && !svg.includes('<r>') && !/&(?!amp;|lt;|gt;|quot;|#)/.test(svg), 'no raw markup or bare ampersands');
  assert.ok(svg.includes('&quot;&amp;&lt;'));
  assert.ok(!/(?:href|src)=["'](?:https?:)?\/\//.test(svg) && !svg.includes('url(http'), 'no external resources (GitHub shows SVGs as images)');
  // Tags are balanced (a cheap well-formedness check; void HTML tags are self-closed).
  const stack = [];
  for (const [, closing, name, selfClosing] of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (selfClosing) continue;
    if (!closing) stack.push(name);
    else assert.equal(stack.pop(), name);
  }
  assert.deepEqual(stack, []);
  assert.ok(buildAccessAnimationHtml({ login: 'konard', ownerType: 'User', captions }).startsWith('<!doctype html>'));
});

await test('identicons and octicons are deterministic inline SVG', () => {
  assert.equal(identicon('konard'), identicon('KONARD'));
  assert.notEqual(identicon('konard'), identicon('other'));
  assert.match(octicon('people'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="oi" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M/);
  assert.ok(Object.keys(OCTICON_PATHS).length >= 30);
  assert.throws(() => octicon('no-such-icon'), /no-such-icon/);
});

// --- GIF from screenshots -------------------------------------------------

const solid = (width, height, rgba) => {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.writeUInt32BE(rgba, i * 4);
  return { width, height, data };
};
const paint = (image, x, y, rgba) => {
  const copy = { ...image, data: Buffer.from(image.data) };
  copy.data.writeUInt32BE(rgba, (y * image.width + x) * 4);
  return copy;
};

// One-frame GIF89a with a 4-color global table and a 1x1 image, like gifenc writes.
function oneFrameGif({ transparentIndex = null, table = [0x0d1117, 0xf0f6fc, 0x238636, 0x000000] } = {}) {
  const colors = Buffer.concat(table.map(rgb => Buffer.from([rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff])));
  return Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0x81, 0, 0]), colors, Buffer.from([0x21, 0xf9, 4, transparentIndex === null ? 8 : 9, 10, 0, transparentIndex ?? 0, 0]), Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0, 0x3b])]);
}

await test('PNG round trip, changed-area bounds and transparent crops', () => {
  const base = solid(6, 4, 0x0d1117ff);
  assert.deepEqual(decodePng(encodePng(base)), base);
  const changed = paint(paint(base, 1, 1, 0xffffffff), 4, 2, 0x238636ff);
  assert.equal(diffBounds(base, base), null);
  assert.deepEqual(diffBounds(base, changed), { left: 1, top: 1, width: 4, height: 2 });
  const crop = cropImage(changed, { left: 1, top: 1, width: 4, height: 2 }, base);
  assert.equal(crop.data.readUInt32BE(0), 0xffffffff);
  assert.equal(crop.data.readUInt32BE(4), 0, 'unchanged pixels are transparent');
  assert.equal(crop.data.readUInt32BE((1 * 4 + 3) * 4), 0x238636ff);
  assert.throws(() => decodePng(Buffer.from('not a png')), /not a PNG/);
});

await test('spliced GIF: pieces at their offsets, drawn over each other, with their own colors and timing', () => {
  const gif = spliceGifFrames({
    width: 960,
    height: 640,
    frames: [
      { left: 0, top: 0, width: 1, height: 1, gif: oneFrameGif(), delay: 60 },
      { left: 300, top: 200, width: 1, height: 1, gif: oneFrameGif({ transparentIndex: 3 }), delay: 1 },
    ],
  });
  assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
  assert.deepEqual([gif.readUInt16LE(6), gif.readUInt16LE(8)], [960, 640]);
  assert.ok(gif.includes(Buffer.from('NETSCAPE2.0')), 'loops');
  const controls = readControls(gif);
  assert.deepEqual(controls, [
    { packed: 0x04, delay: 60, index: 0 },
    { packed: 0x05, delay: 2, index: 3 },
  ]);
  const second = descriptorAt(gif, 1);
  assert.equal(gif[second], 0x2c);
  assert.deepEqual([gif.readUInt16LE(second + 1), gif.readUInt16LE(second + 3)], [300, 200]);
  assert.equal(gif[second + 9], 0x81, 'local color table from the piece');
  assert.equal(gif.at(-1), 0x3b);
  assert.deepEqual(readGifImage(gif).table, readGifImage(oneFrameGif()).table);
});

await test('palettes keep exact colors when they fit, else split at full precision', () => {
  const image = paint(paint(solid(4, 4, 0x0d1117ff), 0, 0, 0x010409ff), 1, 0, 0x151b23ff);
  const exact = buildPalette(image);
  assert.deepEqual(new Set(exact.map(String)), new Set(['13,17,23', '1,4,9', '21,27,35']), 'GitHub dark grays stay apart');
  // 64 grays into 4 colors: each one covers a quarter of the range.
  const ramp = { width: 64, height: 1, data: Buffer.alloc(64 * 4) };
  for (let i = 0; i < 64; i++) ramp.data.writeUInt32BE((i * 4 * 0x010101 * 256 + 0xff) >>> 0, i * 4);
  const reduced = buildPalette(ramp, 4).sort((p, q) => p[0] - q[0]);
  assert.equal(reduced.length, 4);
  reduced.forEach((color, i) => assert.ok(Math.abs(color[0] - (i * 64 + 30)) <= 2, `bucket ${i}: ${color}`));
  const snapped = snapToPalette(ramp, reduced);
  assert.deepEqual([...snapped.data.subarray(0, 4)], [...reduced[0], 255]);
  assert.deepEqual([...snapped.data.subarray(63 * 4)], [...reduced[3], 255]);
  const withHole = { ...ramp, data: Buffer.from(ramp.data) };
  withHole.data.writeUInt32BE(0, 0);
  assert.equal(snapToPalette(withHole, reduced).data.readUInt32BE(0), 0, 'transparent pixels stay transparent');
  assert.equal(buildPalette(withHole, 256).length, 63);
});

await test('encodeDiffGif keeps the first frame whole, then only changes; still frames lengthen the previous one', async () => {
  const base = solid(8, 6, 0x0d1117ff);
  const moved = paint(paint(base, 5, 4, 0xffffffff), 7, 5, 0x238636ff);
  const calls = [];
  const encodeAnimation = async ([png], options) => {
    calls.push({ image: decodePng(png), options });
    const transparentIndex = options.palette.findIndex(color => color[3] === 0);
    return oneFrameGif({ transparentIndex: transparentIndex < 0 ? null : transparentIndex });
  };
  const shots = [base, base, moved, moved, moved].map(image => ({ png: encodePng(image), delay: 10 }));
  const gif = await encodeDiffGif({ shots, encodeAnimation });
  assert.deepEqual(
    calls.map(call => [call.image.width, call.image.height]),
    [
      [8, 6],
      [3, 2],
    ],
    'whole first frame, then the rectangle around the changes'
  );
  assert.ok(
    calls.every(call => call.options.dither === true),
    'exact palette lookup, not the 4-bit quantizer'
  );
  assert.deepEqual(calls[0].options.palette, [
    [13, 17, 23, 255],
    [13, 17, 23, 255],
  ]);
  assert.deepEqual(new Set(calls[1].options.palette.map(String)), new Set(['13,17,23,255', '255,255,255,255', '35,134,54,255', '0,0,0,0']));
  assert.deepEqual(calls[1].options.palette.at(-1), [0, 0, 0, 0], 'one explicit transparent entry');
  assert.equal(calls[1].image.data.readUInt32BE(0), 0xffffffff);
  assert.equal(calls[1].image.data.readUInt32BE(4), 0, 'unchanged pixels inside the rectangle are transparent');
  assert.deepEqual(
    readControls(gif).map(control => control.delay),
    [20, 30]
  );
  const second = descriptorAt(gif, 1);
  assert.deepEqual([gif.readUInt16LE(second + 1), gif.readUInt16LE(second + 3)], [5, 4]);
  await assert.rejects(encodeDiffGif({ shots: [], encodeAnimation }), /no frames/);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
