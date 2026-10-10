/**
 * Record the "give Hive Mind write access" guide on the real github.com page.
 *
 * The committed animations (docs/assets/github-access/) are a replica of the
 * Collaborators page. This records the same story on the real page, with the
 * same overlay: cursor, highlight ring, click ripple and numbered captions. It
 * drives a logged-in browser through Settings → Collaborators → Add people →
 * search → (Write role) → "Add … to REPO", screenshots every frame and encodes
 * them with encodeDiffGif().
 *
 * The final "Add … to REPO" button is only highlighted, not clicked, unless
 * `sendInvite` is set: clicking it sends a real invitation.
 *
 * GitHub changes its markup; each target is a list of Playwright selectors
 * tried in order, so a new label only needs one more entry here.
 */

import { CURSOR_SVG, OVERLAY_CSS } from '../src/github-access-scene.lib.mjs';
import { octicon } from '../src/github-octicons.lib.mjs';

const isOrganizationOwner = ownerType => String(ownerType || '').toLowerCase() === 'organization';
const escapeRegex = text => String(text).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * What to point at, in order. `click` is true for real clicks, false for a
 * ripple only, and 'invite' for the button that sends the invitation.
 */
export function getRecorderSteps({ login, ownerType }) {
  const name = escapeRegex(login);
  return [{ id: 'open', click: false, targets: ['nav a[href$="/settings/access"]', 'a[href$="/settings/access"]'] }, { id: 'add', click: true, targets: ['role=button[name="Add people"]', 'button:has-text("Add people")'] }, { id: 'search', click: true, type: login, targets: ['role=dialog >> input[placeholder*="username" i]', 'role=dialog >> role=combobox', 'role=dialog >> input[type="text"]'] }, { id: 'select', click: true, targets: [`role=dialog >> role=option[name=/${name}/i]`, `role=dialog >> text=/^${name}$/i`] }, ...(isOrganizationOwner(ownerType) ? [{ id: 'role', click: true, targets: ['role=dialog >> role=radio[name=/^Write/]', 'role=dialog >> label:has-text("Write")', 'role=dialog >> text="Write"'] }] : []), { id: 'confirm', click: 'invite', targets: ['role=dialog >> role=button[name=/^Add .+ to /]', 'role=dialog >> button:has-text("to this repository")'] }];
}

/** Selectors for the invitation row that appears after a real invite. */
export const PENDING_TARGETS = ['text=/Pending invite/i', 'text=/Awaiting .+ response/i'];

// Runs in the page: (re)create the overlay. Captions are set with textContent.
const INSTALL_OVERLAY = ({ css, cursor, logo }) => {
  const doc = globalThis.document;
  doc.getElementById('hm-overlay')?.remove();
  const root = doc.createElement('div');
  root.id = 'hm-overlay';
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif';
  const style = doc.createElement('style');
  style.textContent = css;
  root.append(style);
  const part = (id, className, html = '') => {
    const element = doc.createElement('div');
    element.id = id;
    element.className = className;
    element.innerHTML = html;
    root.append(element);
    return element;
  };
  part('hm-ring', 'hm-ring');
  part('hm-ripple', 'hm-ripple');
  part('hm-cursor', 'hm-cursor', cursor);
  const caption = part('hm-caption', 'hm-caption', logo);
  const text = doc.createElement('span');
  text.id = 'hm-caption-text';
  text.style.cssText = 'overflow:hidden;text-overflow:ellipsis';
  caption.append(text);
  doc.documentElement.append(root);
};

// Runs in the page: draw one frame of the overlay.
const DRAW_OVERLAY = ({ cursor, ring, ripple, caption }) => {
  const doc = globalThis.document;
  const get = id => doc.getElementById(id);
  if (!get('hm-overlay')) return false;
  get('hm-cursor').style.transform = `translate(${cursor.x}px,${cursor.y}px)`;
  Object.assign(get('hm-ring').style, ring ? { opacity: '1', left: `${ring.x}px`, top: `${ring.y}px`, width: `${ring.width}px`, height: `${ring.height}px` } : { opacity: '0' });
  Object.assign(get('hm-ripple').style, ripple ? { opacity: String(1 - ripple.progress), left: `${ripple.x}px`, top: `${ripple.y}px`, transform: `scale(${0.3 + ripple.progress})` } : { opacity: '0' });
  get('hm-caption').style.opacity = caption ? '1' : '0';
  get('hm-caption-text').textContent = caption || '';
  return true;
};

const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Cursor positions for a move of `frames` frames, eased, ending exactly on `to`. */
export function cursorPath(from, to, frames) {
  return Array.from({ length: Math.max(1, frames) }, (_, i) => {
    const t = easeInOut((i + 1) / Math.max(1, frames));
    return { x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) };
  });
}

/** First visible match of any selector, polling until `timeoutMs`. */
export async function findTarget(page, selectors, { timeoutMs = 15000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    if (Date.now() >= deadline) throw new Error(`none of these is visible: ${selectors.join(' | ')}`);
    await sleep(250);
  }
}

/**
 * Drive the page and screenshot each frame. The page must already show the
 * repository's Collaborators settings.
 *
 * @param {Object} options
 * @param {Object} options.page - Playwright page
 * @param {string} options.login - account to invite
 * @param {string} [options.ownerType] - 'User' or 'Organization'
 * @param {Object} options.captions - from buildAccessAnimationCaptions()
 * @param {Function} options.screenshot - page => PNG bytes
 * @param {boolean} [options.sendInvite] - really click the final button
 * @param {number} [options.fps]
 * @param {Object} [options.find] - findTarget() options
 * @param {Function} [options.log]
 * @returns {Promise<Array<{png: Uint8Array, delay: number}>>} shots for encodeDiffGif()
 */
export async function recordAccessGuide({ page, login, ownerType, captions, screenshot, sendInvite = false, fps = 10, find = {}, log = () => {} }) {
  const shots = [];
  const viewport = page.viewportSize?.() || { width: 1280, height: 800 };
  const state = { cursor: { x: Math.round(viewport.width / 2), y: Math.round(viewport.height / 2) }, ring: null, ripple: null, caption: null };
  const install = () => page.evaluate(INSTALL_OVERLAY, { css: OVERLAY_CSS, cursor: CURSOR_SVG, logo: `<span class="hm-logo">${octicon('mark-github', { size: 20 })}</span>` });
  const frame = async () => {
    if (!(await page.evaluate(DRAW_OVERLAY, state))) {
      await install();
      await page.evaluate(DRAW_OVERLAY, state);
    }
    shots.push({ png: await screenshot(page), delay: 100 / fps });
  };
  const hold = async seconds => {
    for (let i = 0; i < Math.round(seconds * fps); i++) await frame();
  };
  const point = async locator => {
    await locator.scrollIntoViewIfNeeded?.().catch(() => {});
    const box = await locator.boundingBox();
    if (!box) throw new Error('target has no box');
    state.ring = null;
    for (const position of cursorPath(state.cursor, { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }, Math.round(0.8 * fps))) {
      state.cursor = position;
      await frame();
    }
    state.ring = { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 };
    await hold(0.5);
  };
  const ripple = async () => {
    const frames = Math.round(0.4 * fps);
    for (let i = 0; i < frames; i++) {
      state.ripple = { ...state.cursor, progress: i / frames };
      await frame();
    }
    state.ripple = null;
  };

  await install();
  for (const step of getRecorderSteps({ login, ownerType })) {
    log(`${step.id}: looking for ${step.targets[0]}`);
    let target;
    try {
      target = await findTarget(page, step.targets, find);
    } catch (error) {
      throw new Error(`step "${step.id}": ${error.message}`, { cause: error });
    }
    state.caption = captions[step.id];
    await point(target);
    await ripple();
    if (step.click === true || (step.click === 'invite' && sendInvite)) await target.click();
    for (const char of step.type || '') {
      await page.keyboard.type(char);
      await hold(0.15);
    }
    await hold(step.click === 'invite' ? 2.5 : 0.6);
  }
  if (sendInvite) {
    state.ring = null;
    const pending = await findTarget(page, PENDING_TARGETS, find);
    state.caption = captions.pending;
    await point(pending);
    await hold(2.5);
  }
  return shots;
}

/**
 * A stand-in for the Collaborators page with the same roles and labels, to
 * try the recorder without a GitHub session (`--mock`).
 */
export function buildRecorderMockPage({ login, ownerType, owner = 'your-account', repo = 'your-repo' }) {
  const organization = isOrganizationOwner(ownerType);
  const esc = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const js = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const roles = organization ? `<fieldset id="roles" hidden><legend>Choose a role</legend>${['Read', 'Triage', 'Write', 'Maintain', 'Admin'].map(role => `<label><input type="radio" name="role" value="${role}"/> ${role}</label>`).join('')}</fieldset>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Collaborators</title><style>
body{margin:0;background:#0d1117;color:#f0f6fc;font:14px -apple-system,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif}
header{padding:16px 24px;background:#010409;border-bottom:1px solid #3d444d}main{display:flex;gap:24px;padding:24px}
nav{width:220px}nav a{display:block;padding:6px 8px;border-radius:6px;color:#f0f6fc;text-decoration:none}nav a[aria-current]{background:#262c36}
section{flex:1}button{background:#212830;color:#f0f6fc;border:1px solid #3d444d;border-radius:6px;padding:5px 16px;font:inherit;cursor:pointer}
button.primary{background:#238636;border-color:#2ea043;width:100%;margin-top:12px}
dialog{background:#151b23;color:#f0f6fc;border:1px solid #3d444d;border-radius:12px;width:440px;padding:16px}
input[type=text]{width:100%;box-sizing:border-box;background:#0d1117;color:#f0f6fc;border:1px solid #3d444d;border-radius:6px;padding:6px 10px;font:inherit}
[role=listbox] [role=option]{padding:8px;border-radius:6px}[role=option]:hover{background:#262c36}fieldset{border:0;padding:8px 0}label{display:block;padding:4px 0}
</style></head><body><header><b>${esc(owner)} / ${esc(repo)}</b> · Settings</header><main>
<nav><a href="#">General</a><a href="/${esc(owner)}/${esc(repo)}/settings/access" aria-current="page" onclick="return false">${organization ? 'Collaborators and teams' : 'Collaborators'}</a></nav>
<section><h2>${organization ? 'Collaborators and teams' : 'Who has access'}</h2><button id="add">Add people</button><p id="pending" hidden>${esc(login)} · Pending invite</p></section></main>
<dialog id="dialog" aria-label="Add people to ${esc(repo)}"><h3>Add people to ${esc(repo)}</h3>
<input type="text" placeholder="Search by username, full name, or email" aria-label="Search by username, full name, or email"/>
<div role="listbox" id="results"></div>${roles}<button class="primary" id="confirm" hidden>Add ${esc(login)} to ${esc(repo)}</button></dialog>
<script>
const $ = id => document.getElementById(id);
$('add').onclick = () => $('dialog').show();
document.querySelector('dialog input').oninput = event => {
  $('results').innerHTML = '';
  if (!${js(String(login).toLowerCase())}.startsWith(event.target.value.toLowerCase()) || !event.target.value) return;
  const option = document.createElement('div');
  option.setAttribute('role', 'option');
  option.textContent = ${js(login)};
  option.onclick = () => { $('results').innerHTML = ''; ${organization ? "$('roles').hidden = false;" : ''} $('confirm').hidden = false; };
  $('results').append(option);
};
$('confirm').onclick = () => { $('dialog').close(); $('pending').hidden = false; };
</script></body></html>`;
}
