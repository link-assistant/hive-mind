/**
 * The "give Hive Mind write access" animation as one animated scene.
 *
 * The scene is a dark-theme replica of GitHub's Settings → Collaborators page
 * (Primer colors, Octicons, GitHub's own labels) plus an overlay: a mouse
 * cursor that moves to each control, a click ripple, a highlight around the
 * control and a caption bar. Everything that changes is driven by CSS
 * keyframes on one timeline, so the same markup is:
 *
 * - an animated SVG (the markup inside a foreignObject; plays in any browser
 *   and in GitHub's Markdown preview), see buildAccessAnimationSvg();
 * - a GIF: github-access-animation.lib.mjs pauses the keyframes at sample
 *   times in Chromium and screenshots each one with browser-commander.
 *
 * The overlay (cursor, ripple, highlight, caption) is also injected into the
 * real github.com page by scripts/record-github-access-guide.mjs, so a
 * recording of the real page looks the same as this replica.
 *
 * Pure module: no browser, no file system.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2998
 */

import { octicon } from './github-octicons.lib.mjs';
import { isOrganizationOwner } from './github-access-guide.lib.mjs';

export const SCENE_SIZE = Object.freeze({ width: 960, height: 640 });
const CAPTION_HEIGHT = 56;

const escapeXml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** Primer dark theme colors (https://primer.style/foundations/color). */
const C = Object.freeze({
  canvas: '#0d1117',
  inset: '#010409',
  subtle: '#151b23',
  border: '#3d444d',
  muted: '#9198a1',
  fg: '#f0f6fc',
  accent: '#4493f8',
  accentEmphasis: '#1f6feb',
  button: '#212830',
  success: '#238636',
  underline: '#f78166',
  attention: '#d29922',
});

/**
 * Overlay styles shared with the real-page recorder. Class names are prefixed
 * with `hm-` so they cannot clash with github.com's own CSS.
 */
export const OVERLAY_CSS = `
.hm-cursor{position:absolute;left:0;top:0;width:22px;height:26px;margin:-2px 0 0 -3px;z-index:2147483646;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
.hm-ripple{position:absolute;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid ${C.accent};background:rgba(68,147,248,.25);z-index:2147483645;pointer-events:none;opacity:0}
.hm-ring{position:absolute;border:2px solid ${C.attention};border-radius:8px;box-shadow:0 0 0 4px rgba(210,153,34,.25),0 0 16px rgba(210,153,34,.45);z-index:2147483644;pointer-events:none;opacity:0}
.hm-caption{position:absolute;left:0;right:0;bottom:0;height:${CAPTION_HEIGHT}px;display:flex;align-items:center;gap:12px;padding:0 20px;background:#161b22;border-top:2px solid ${C.accentEmphasis};color:${C.fg};font-size:17px;font-weight:600;z-index:2147483647;opacity:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hm-caption .hm-logo{color:${C.accent};flex:none;display:flex}`;

/** Mouse pointer: white arrow with a dark outline, readable on the dark UI. */
export const CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 26" width="22" height="26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L14.5 22.6 L11 15.3 L17.5 15.3 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';

const SCENE_CSS = `
#hm-root{position:relative;width:${SCENE_SIZE.width}px;height:${SCENE_SIZE.height}px;overflow:hidden;background:${C.canvas};color:${C.fg};font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,"WenQuanYi Zen Hei","Noto Sans CJK SC","Noto Sans Devanagari",sans-serif;-webkit-font-smoothing:antialiased}
#hm-root *{box-sizing:border-box}
#hm-root .abs{position:absolute}
#hm-root .oi{flex:none;vertical-align:text-bottom}
#hm-root .row{display:flex;align-items:center}
#hm-root .muted{color:${C.muted}}
#hm-root .small{font-size:12px}
#hm-root .b{font-weight:600}
#hm-root .link{color:${C.accent}}
#hm-root .ell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#hm-root .chrome{left:0;top:0;width:100%;height:40px;background:#1c2128;border-bottom:1px solid #000;gap:8px;padding:0 16px}
#hm-root .light{width:12px;height:12px;border-radius:50%}
#hm-root .address{position:absolute;left:250px;width:460px;top:7px;height:26px;border-radius:7px;background:#2d333b;color:#c9d1d9;font-size:13px;justify-content:center;gap:6px}
#hm-root .header{left:0;top:40px;width:100%;height:104px;background:${C.inset};border-bottom:1px solid ${C.border}}
#hm-root .iconbtn{width:32px;height:32px;border:1px solid ${C.border};border-radius:6px;justify-content:center;color:${C.muted}}
#hm-root .search{height:32px;border:1px solid ${C.border};border-radius:6px;padding:0 8px;gap:8px;color:${C.muted}}
#hm-root .kbd{border:1px solid ${C.border};border-radius:4px;padding:0 4px;font-size:11px;line-height:16px}
#hm-root .tabs{left:16px;top:56px;height:48px;gap:4px}
#hm-root .tab{height:48px;padding:0 8px;gap:8px;position:relative;color:${C.fg}}
#hm-root .tab .oi{color:${C.muted}}
#hm-root .tab.on{font-weight:600}
#hm-root .tab.on::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:6px;background:${C.underline}}
#hm-root .count{background:#2f3742;border-radius:12px;padding:0 6px;font-size:12px;font-weight:500;line-height:18px}
#hm-root .side{left:24px;top:156px;width:220px}
#hm-root .item{height:30px;padding:0 8px;gap:8px;border-radius:6px;position:relative;margin-bottom:2px}
#hm-root .item .oi{color:${C.muted}}
#hm-root .item.on{background:${C.subtle};font-weight:600}
#hm-root .item.on::before{content:"";position:absolute;left:-8px;top:6px;width:4px;height:18px;border-radius:6px;background:${C.accentEmphasis}}
#hm-root .group{font-size:12px;font-weight:600;color:${C.muted};padding:10px 8px 4px;border-top:1px solid ${C.border};margin-top:6px}
#hm-root .main{left:272px;width:664px}
#hm-root .box{border:1px solid ${C.border};border-radius:6px}
#hm-root .btn{height:32px;padding:0 12px;border:1px solid ${C.border};border-radius:6px;background:${C.button};font-weight:500;justify-content:center;gap:6px;white-space:nowrap}
#hm-root .btn.primary{background:${C.success};border-color:rgba(240,246,252,.1);color:#fff}
#hm-root .btn.disabled{color:#656c76;background:${C.subtle}}
#hm-root .label{border:1px solid ${C.border};border-radius:12px;padding:0 7px;font-size:12px;font-weight:500;line-height:18px;color:${C.muted}}
#hm-root .label.pending{border-color:#9e6a03;color:${C.attention}}
#hm-root .dim{left:0;top:0;width:100%;height:${SCENE_SIZE.height - CAPTION_HEIGHT}px;background:rgba(1,4,9,.6)}
#hm-root .overlay{background:#151b23;border:1px solid ${C.border};border-radius:12px;box-shadow:0 8px 24px rgba(1,4,9,.8)}
#hm-root .input{height:34px;border:2px solid ${C.accentEmphasis};border-radius:6px;padding:0 8px;gap:8px;background:${C.canvas}}
#hm-root .caret{display:inline-block;width:1px;height:16px;background:${C.fg};animation:hm-blink 1s steps(1) infinite}
@keyframes hm-blink{50%{opacity:0}}
#hm-root .radio{width:16px;height:16px;border-radius:50%;border:1px solid #757e8a;flex:none}
#hm-root .radio.on{border:5px solid ${C.accentEmphasis}}
#hm-root .avatar{border-radius:50%;flex:none;background:#2f3742}
#hm-root .layer{opacity:0}`;

/** GitHub-style identicon: a 5x5 mirrored pattern colored from a hash of the login. */
export function identicon(login, size = 20) {
  let hash = 2166136261;
  for (const ch of String(login).toLowerCase()) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
  const hue = hash % 360;
  const cells = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (!((hash >>> (y * 3 + x)) & 1)) continue;
      cells.push(`<rect x="${x + 1}" y="${y + 1}" width="1" height="1"/>`);
      if (x < 2) cells.push(`<rect x="${5 - x}" y="${y + 1}" width="1" height="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="avatar" width="${size}" height="${size}" viewBox="0 0 7 7"><rect width="7" height="7" fill="#f0f0f0"/><g fill="hsl(${hue},55%,55%)">${cells.join('')}</g></svg>`;
}

/**
 * Where the controls the cursor visits are, in scene pixels. Fixed positions
 * keep the cursor on target whatever font the viewer has.
 */
export function getSceneTargets({ ownerType }) {
  const organization = isOrganizationOwner(ownerType);
  return organization
    ? {
        sidebar: { x: 24, y: 220, width: 220, height: 30 },
        addPeople: { x: 744, y: 360, width: 96, height: 32 },
        search: { x: 618, y: 446, width: 306, height: 34 },
        result: { x: 618, y: 490, width: 306, height: 40 },
        roleWrite: { x: 296, y: 364, width: 368, height: 44 },
        confirm: { x: 296, y: 510, width: 368, height: 36 },
        pending: { x: 273, y: 528, width: 662, height: 46 },
      }
    : {
        sidebar: { x: 24, y: 220, width: 220, height: 30 },
        addPeople: { x: 552, y: 452, width: 104, height: 32 },
        search: { x: 276, y: 234, width: 408, height: 36 },
        result: { x: 276, y: 274, width: 408, height: 44 },
        confirm: { x: 276, y: 310, width: 408, height: 36 },
        pending: { x: 284, y: 362, width: 640, height: 52 },
      };
}

const at = ({ x, y, width, height }, extra = '') => `left:${x}px;top:${y}px;width:${width}px;height:${height}px;${extra}`;
const center = ({ x, y, width, height }) => ({ x: Math.round(x + width / 2), y: Math.round(y + height / 2) });

/**
 * One timeline for every moving part. Times are in seconds.
 */
export function createTimeline({ start = { x: 480, y: 300 } } = {}) {
  let now = 0;
  let position = start;
  const layers = new Map();
  const cursor = [{ t: 0, ...start }];
  const clicks = [];
  const timeline = {
    get now() {
      return now;
    },
    get position() {
      return position;
    },
    layers,
    cursor,
    clicks,
    wait(seconds) {
      now += seconds;
      return timeline;
    },
    show(id, { fade = 0.15 } = {}) {
      const intervals = layers.get(id) || [];
      if (!intervals.length || intervals.at(-1).to !== null) intervals.push({ from: now, to: null, fade });
      layers.set(id, intervals);
      return timeline;
    },
    hide(id) {
      const open = layers.get(id)?.at(-1);
      if (open && open.to === null) open.to = now;
      return timeline;
    },
    move(point, seconds = 0.7) {
      cursor.push({ t: now, ...position });
      now += seconds;
      position = point;
      cursor.push({ t: now, ...point });
      return timeline;
    },
    click() {
      clicks.push({ t: now, ...position });
      now += 0.35;
      return timeline;
    },
    end(hold = 0) {
      now += hold;
      for (const intervals of layers.values()) if (intervals.at(-1)?.to === null) intervals.at(-1).to = now;
      cursor.push({ t: now, ...position });
      return { duration: now, layers, cursor, clicks };
    },
  };
  return timeline;
}

const pct = (t, duration) => `${Math.min(100, Math.max(0, (t / duration) * 100)).toFixed(3)}%`;

/** CSS keyframes for the timeline (the scene's only moving parts). */
export function buildTimelineCss({ duration, layers, cursor, clicks }) {
  const rules = [];
  const run = name => `animation:${name} ${duration.toFixed(3)}s linear infinite`;
  for (const [id, intervals] of layers) {
    const frames = [`0%{opacity:${intervals[0].from <= 0 ? 1 : 0}}`];
    for (const { from, to, fade } of intervals) {
      // step-end: no half-visible layer between keyframes (sampled GIF frames
      // would catch it and repaint everything under it).
      if (from > 0) frames.push(`${pct(from, duration)}{opacity:0${fade > 0 ? '' : ';animation-timing-function:step-end'}}`, `${pct(from + Math.max(fade, 0.01), duration)}{opacity:1}`);
      if (to < duration) frames.push(`${pct(to, duration)}{opacity:1;animation-timing-function:step-end}`, `${pct(to + 0.01, duration)}{opacity:0}`);
    }
    frames.push(`100%{opacity:${intervals.at(-1).to >= duration ? 1 : 0}}`);
    rules.push(`#hm-root #${id}{${run(`hm-${id}`)}}`, `@keyframes hm-${id}{${frames.join('')}}`);
  }
  const moves = cursor.map(({ t, x, y }) => `${pct(t, duration)}{transform:translate(${x}px,${y}px);animation-timing-function:ease-in-out}`);
  rules.push(`#hm-root #hm-cursor{${run('hm-cursor')}}`, `@keyframes hm-cursor{${moves.join('')}}`);
  clicks.forEach(({ t }, index) => {
    const frames = ['0%{opacity:0;transform:scale(.3)}', `${pct(t, duration)}{opacity:0;transform:scale(.3)}`, `${pct(t + 0.02, duration)}{opacity:1;transform:scale(.3)}`, `${pct(t + 0.5, duration)}{opacity:0;transform:scale(1.3)}`, '100%{opacity:0;transform:scale(1.3)}'];
    rules.push(`#hm-root #hm-click-${index}{${run(`hm-click-${index}`)}}`, `@keyframes hm-click-${index}{${frames.join('')}}`);
  });
  return rules.join('\n');
}

function chromeBar({ owner, repo }) {
  const lights = ['#ff5f57', '#febc2e', '#28c840'].map(color => `<span class="light" style="background:${color}"></span>`).join('');
  return `<div class="abs chrome row">${lights}<div class="address row">${octicon('lock', { size: 12 })}<span>github.com/${escapeXml(owner)}/${escapeXml(repo)}/settings/access</span></div></div>`;
}

function githubHeader({ owner, repo, viewer }) {
  const tabs = [
    ['code', 'Code'],
    ['issue-opened', 'Issues', 12],
    ['git-pull-request', 'Pull requests', 3],
    ['play', 'Actions'],
    ['table', 'Projects'],
    ['book', 'Wiki'],
    ['shield', 'Security'],
    ['graph', 'Insights'],
    ['gear', 'Settings'],
  ]
    .map(([icon, name, count]) => `<span class="tab row${name === 'Settings' ? ' on' : ''}">${octicon(icon)}<span>${name}</span>${count ? `<span class="count">${count}</span>` : ''}</span>`)
    .join('');
  return `<div class="abs header">
<div class="abs row" style="left:16px;top:12px;gap:12px"><span class="iconbtn row">${octicon('three-bars')}</span><span style="color:${C.fg};display:flex">${octicon('mark-github', { size: 32 })}</span><span class="row" style="gap:6px;font-size:14px"><span>${escapeXml(owner)}</span><span class="muted">/</span><span class="b">${escapeXml(repo)}</span></span></div>
<div class="abs row" style="right:16px;top:12px;gap:8px"><span class="search row" style="width:200px">${octicon('search')}<span>Type <span class="kbd">/</span> to search</span></span><span class="iconbtn row" style="width:48px">${octicon('plus')}${octicon('triangle-down')}</span><span class="iconbtn row">${octicon('issue-opened')}</span><span class="iconbtn row">${octicon('git-pull-request')}</span><span class="iconbtn row">${octicon('inbox')}</span>${identicon(viewer, 32)}</div>
<div class="abs tabs row">${tabs}</div></div>`;
}

function sidebar({ organization }) {
  const item = (icon, name, on = false) => `<div class="item row${on ? ' on' : ''}">${octicon(icon)}<span>${name}</span></div>`;
  return `<div class="abs side">${item('gear', 'General')}
<div class="group">Access</div>${item('people', organization ? 'Collaborators and teams' : 'Collaborators', true)}${item('report', 'Moderation options')}
<div class="group">Code and automation</div>${item('git-branch', 'Branches')}${item('tag', 'Tags')}${item('checklist', 'Rules')}${item('play', 'Actions')}${item('webhook', 'Webhooks')}${item('server', 'Environments')}${item('browser', 'Pages')}</div>`;
}

/** Typed text in the search input, one layer per prefix. */
function typedLayers(login, prefix) {
  const text = String(login);
  const steps = [];
  for (let i = 1; i <= text.length; i++) steps.push(`<span id="${prefix}-${i}" class="abs layer" style="left:0;top:0">${escapeXml(text.slice(0, i))}<span class="caret"></span></span>`);
  return steps.join('');
}

function organizationPage({ login, repo, targets, confirmLabel }) {
  const user = escapeXml(login);
  const card = (left, title, side, body) => `<div class="abs box" style="left:${left}px;top:112px;width:212px;height:76px;padding:10px 12px"><div class="row b" style="justify-content:space-between"><span>${title}</span>${side}</div><div class="small muted" style="line-height:18px;margin-top:4px">${body}</div></div>`;
  const roles = [
    ['Read', 'Recommended for non-code contributors who want to view or discuss your project'],
    ['Triage', 'Recommended for contributors who need to manage issues and pull requests'],
    ['Write', 'Recommended for contributors who actively push to your project'],
    ['Maintain', 'Recommended for project managers who need to manage the repository'],
    ['Admin', 'Full access to the project, including sensitive and destructive actions'],
  ];
  const roleRows = roles
    .map(([name, description], index) => {
      const radio = name === 'Read' ? '<span id="hm-radio-read" class="abs radio on layer" style="left:0;top:4px"></span>' : name === 'Write' ? '<span id="hm-radio-write" class="abs radio on layer" style="left:0;top:4px"></span>' : '';
      return `<div class="abs" style="left:16px;top:${126 + index * 44}px;width:368px;height:44px"><span class="abs radio" style="left:0;top:4px"></span>${radio}<div style="margin-left:26px"><div class="b">${name}</div><div class="small muted ell">${description}</div></div></div>`;
    })
    .join('');
  return `<div class="abs main" style="top:156px;height:420px">
<div style="font-size:24px;line-height:32px">Collaborators and teams</div>
<div class="abs box row" style="left:0;top:48px;width:664px;height:52px;padding:0 12px;gap:12px"><span class="box row" style="width:32px;height:32px;justify-content:center;color:${C.muted}">${octicon('repo')}</span><div style="line-height:18px"><div class="b">Public repository</div><div class="small muted">This repository is public and visible to anyone</div></div><span class="btn row" style="margin-left:auto">Manage visibility</span></div>
${card(0, 'Base role', '<span class="label">Read</span>', 'All 4 members can access this repository.')}
${card(226, 'Direct access', `<span class="muted">${octicon('people')}</span>`, '1 member has access to this repository.')}
${card(452, 'Organization access', `<span class="muted">${octicon('organization')}</span>`, 'No teams or members have access through the organization.')}
<div class="abs b" style="left:0;top:206px;font-size:16px">Manage access</div>
<span class="abs" style="left:378px;top:210px">Create team</span></div>
<span class="abs btn row" style="${at(targets.addPeople)}">Add people</span>
<span class="abs btn row" style="left:848px;top:360px;width:88px">Add teams</span>
<div class="abs box" style="left:272px;top:404px;width:664px;height:172px;overflow:hidden">
<div class="row" style="height:40px;padding:0 12px;gap:24px;border-bottom:1px solid ${C.border}"><span class="b" style="position:relative;line-height:38px;border-bottom:2px solid ${C.underline}">Direct access</span><span>Organization access</span></div>
<div class="row small" style="height:36px;padding:0 12px;background:${C.subtle};border-bottom:1px solid ${C.border}"><span class="b">1 member</span><span class="muted" style="margin-left:auto">Type: <b style="color:${C.fg}">All</b> · Role: <b style="color:${C.fg}">All</b></span></div>
<div class="row" style="height:48px;padding:0 12px;gap:10px">${identicon('your-org-admin', 28)}<span class="b">your-org-admin</span><span class="muted small">Owner</span><span class="label" style="margin-left:auto">Admin</span></div></div>
<div id="hm-pending" class="abs row layer" style="${at(targets.pending, `background:${C.canvas};border-top:1px solid ${C.border};padding:0 12px;gap:10px`)}">${identicon(login, 28)}<span class="b">${user}</span><span class="label pending">Pending invite</span><span class="muted small">Awaiting ${user}'s response</span><span class="label" style="margin-left:auto">Write</span></div>
<div id="hm-popover" class="abs overlay layer" style="left:606px;top:398px;width:330px;height:144px">
<div class="row b" style="height:40px;padding:0 12px;justify-content:space-between"><span class="ell">Add people to ${escapeXml(repo)}</span><span class="muted">${octicon('x')}</span></div>
<div class="abs input row" style="left:12px;top:48px;width:306px"><span class="muted">${octicon('search')}</span><span style="position:relative;flex:1;height:20px;line-height:20px"><span id="hm-caret-0" class="abs layer" style="left:0;top:2px"><span class="caret"></span></span>${typedLayers(login, 'hm-typed')}</span></div>
<div id="hm-result" class="abs row layer" style="left:12px;top:92px;width:306px;height:40px;padding:0 8px;gap:10px;border-radius:6px;background:#212830">${identicon(login, 20)}<span class="b">${user}</span><span class="muted small">Invite collaborator</span></div></div>
<div id="hm-dialog" class="abs layer" style="left:0;top:0;width:100%;height:100%"><div class="abs dim"></div>
<div class="abs overlay" style="left:280px;top:150px;width:400px;height:412px">
<div class="row b" style="height:48px;padding:0 16px;justify-content:space-between;border-bottom:1px solid ${C.border}"><span class="ell">Add ${user} to ${escapeXml(repo)}</span><span class="muted">${octicon('x')}</span></div>
<div class="row" style="height:48px;padding:0 16px;gap:10px">${identicon(login, 24)}<span class="b">${user}</span><span class="muted small">Invite collaborator</span></div>
<div class="b" style="padding:4px 16px">Choose a role</div>
${roleRows}
<span class="abs btn primary row ell" style="left:16px;top:360px;width:368px;height:36px">${escapeXml(confirmLabel)}</span></div></div>`;
}

function personalPage({ login, repo, targets, confirmLabel }) {
  const user = escapeXml(login);
  const box = (left, title, body) => `<div class="abs box" style="left:${left}px;top:48px;width:324px;height:88px;padding:12px 16px"><div class="small b muted">${title}</div><div class="small" style="line-height:18px;margin-top:6px">${body}</div></div>`;
  return `<div class="abs main" style="top:156px;height:420px">
<div style="font-size:24px;line-height:32px">Who has access</div>
${box(0, 'PUBLIC REPOSITORY', 'This repository is public and visible to anyone. <span class="link">Manage</span>')}
${box(340, 'DIRECT ACCESS', '0 collaborators have access to this repository. Only you can contribute to this repository.')}
<div class="abs box" style="left:0;top:152px;width:664px;height:268px"><div class="row b" style="height:44px;padding:0 16px;font-size:16px;background:${C.subtle};border-bottom:1px solid ${C.border}">Manage access</div></div></div>
<div id="hm-empty" class="abs layer" style="left:272px;top:352px;width:664px;height:220px;text-align:center"><div class="muted" style="margin-top:20px">${octicon('people', { size: 24 })}</div><div class="b" style="font-size:16px;margin-top:4px">You haven't invited any collaborators yet</div></div>
<span id="hm-add-empty" class="abs btn primary row layer" style="${at(targets.addPeople)}">Add people</span>
<div id="hm-pending" class="abs row layer" style="${at(targets.pending, 'padding:0 12px;gap:10px')}">${identicon(login, 32)}<div style="line-height:18px"><div><span class="b">${user}</span> <span class="label pending">Pending Invite</span></div><div class="muted small">Awaiting ${user}'s response</div></div><span class="link small" style="margin-left:auto">Remove</span></div>
<div id="hm-dialog" class="abs layer" style="left:0;top:0;width:100%;height:100%"><div class="abs dim"></div>
<div class="abs overlay" style="left:260px;top:170px;width:440px;height:192px">
<div class="row b" style="height:48px;padding:0 16px;justify-content:space-between;border-bottom:1px solid ${C.border}"><span class="ell">Add a collaborator to ${escapeXml(repo)}</span><span class="muted">${octicon('x')}</span></div></div>
<div id="hm-search" class="abs input row" style="${at(targets.search)}"><span class="muted">${octicon('search')}</span><span style="position:relative;flex:1;height:20px;line-height:20px"><span id="hm-placeholder" class="abs muted ell layer" style="left:0;top:0;width:340px">Search by username, full name, or email</span><span id="hm-caret-0" class="abs layer" style="left:0;top:2px"><span class="caret"></span></span>${typedLayers(login, 'hm-typed')}</span></div>
<div id="hm-picked" class="abs row layer" style="left:276px;top:234px;width:408px;height:56px;padding:0 12px;gap:10px;border:1px solid ${C.border};border-radius:6px;background:${C.canvas}">${identicon(login, 32)}<div style="line-height:18px"><div class="b">${user}</div><div class="muted small">Invite collaborator</div></div></div>
<span id="hm-disabled" class="abs btn disabled row layer" style="${at(targets.confirm)}">Select a collaborator above</span>
<span id="hm-confirm" class="abs btn primary row ell layer" style="${at(targets.confirm)}">${escapeXml(confirmLabel)}</span>
<div id="hm-result" class="abs overlay row layer" style="${at(targets.result, 'border-radius:6px;padding:0 12px;gap:10px')}">${identicon(login, 20)}<span class="b">${user}</span><span class="muted small">Invite collaborator</span></div></div>`;
}

/**
 * Plan the animation: which layer is visible when and where the cursor goes.
 */
export function buildAccessTimeline({ login, ownerType }) {
  const organization = isOrganizationOwner(ownerType);
  const targets = getSceneTargets({ ownerType });
  const tl = createTimeline();
  const step = (id, ring) => {
    for (const other of ['open', 'add', 'search', 'select', 'role', 'confirm', 'pending']) tl.hide(`hm-caption-${other}`).hide(`hm-ring-${other}`);
    tl.show(`hm-caption-${id}`, { fade: 0.25 });
    if (ring) tl.show(`hm-ring-${id}`, { fade: 0.2 });
  };
  // Visible from the start: the page's empty state (personal) and, inside the
  // still hidden dialog, the search field and the disabled button.
  if (!organization) tl.show('hm-empty', { fade: 0 }).show('hm-add-empty', { fade: 0 }).show('hm-search', { fade: 0 }).show('hm-disabled', { fade: 0 });
  step('open', true);
  tl.wait(0.5).move(center(targets.sidebar), 0.9).click().wait(1.2);
  step('add', true);
  tl.move(center(targets.addPeople), 0.9).wait(0.2).click();
  // Dialogs open at once, as on GitHub (a fading backdrop would also repaint the
  // whole page in several GIF frames).
  tl.show(organization ? 'hm-popover' : 'hm-dialog', { fade: organization ? 0.15 : 0 }).show('hm-caret-0');
  if (!organization) tl.show('hm-placeholder', { fade: 0 });
  tl.wait(0.6);
  step('search', true);
  tl.move({ x: targets.search.x + 60, y: targets.search.y + targets.search.height / 2 + 6 }, 0.6).wait(0.3);
  tl.hide('hm-caret-0').hide('hm-placeholder');
  const length = String(login).length;
  for (let i = 1; i <= length; i++) {
    if (i > 1) tl.hide(`hm-typed-${i - 1}`);
    tl.show(`hm-typed-${i}`, { fade: 0 }).wait(0.14);
  }
  tl.wait(0.3).show('hm-result').wait(1);
  step('select', true);
  tl.move(center(targets.result), 0.7).wait(0.2).click();
  tl.hide('hm-result').hide('hm-ring-select');
  if (organization) {
    tl.hide('hm-popover').hide(`hm-typed-${length}`).show('hm-dialog', { fade: 0 }).show('hm-radio-read', { fade: 0 }).wait(0.8);
    step('role', true);
    tl.move({ x: targets.roleWrite.x + 8, y: targets.roleWrite.y + 12 }, 0.8)
      .wait(0.2)
      .click();
    tl.hide('hm-radio-read').show('hm-radio-write', { fade: 0 }).wait(0.8);
  } else {
    tl.hide('hm-search').hide(`hm-typed-${length}`).hide('hm-disabled').show('hm-picked').show('hm-confirm').wait(0.8);
  }
  step('confirm', true);
  tl.move(center(targets.confirm), 0.8).wait(0.3).click();
  tl.hide('hm-dialog').hide('hm-radio-write').hide('hm-radio-read').hide('hm-picked').hide('hm-confirm').hide('hm-empty').hide('hm-add-empty');
  tl.show('hm-pending', { fade: 0.3 });
  step('pending', true);
  tl.wait(0.4).move({ x: 900, y: 180 }, 0.9);
  return { ...tl.end(3.2), targets, organization };
}

function overlayMarkup({ captions, plan, organization }) {
  const ring = (id, target) => (target ? `<div id="hm-ring-${id}" class="hm-ring" style="${at({ x: target.x - 4, y: target.y - 4, width: target.width + 8, height: target.height + 8 })}"></div>` : '');
  const { targets } = plan;
  const rings = [ring('open', targets.sidebar), ring('add', targets.addPeople), ring('search', targets.search), ring('select', targets.result), organization ? ring('role', targets.roleWrite) : '', ring('confirm', targets.confirm), ring('pending', targets.pending)].join('');
  const caption = (id, text) => (text ? `<div id="hm-caption-${id}" class="hm-caption"><span class="hm-logo">${octicon('mark-github', { size: 20 })}</span><span style="overflow:hidden;text-overflow:ellipsis">${escapeXml(text)}</span></div>` : '');
  const captionsMarkup = ['open', 'add', 'search', 'select', 'role', 'confirm', 'pending'].map(id => caption(id, captions[id])).join('');
  const ripples = plan.clicks.map(({ x, y }, index) => `<div id="hm-click-${index}" class="hm-ripple" style="left:${x}px;top:${y}px"></div>`).join('');
  return `${rings}${ripples}<div id="hm-cursor" class="hm-cursor">${CURSOR_SVG}</div>${captionsMarkup}`;
}

/**
 * The animated scene as an XHTML fragment (`<div id="hm-root">` with its own
 * styles), valid both in an HTML page and inside an SVG foreignObject.
 *
 * @param {Object} options
 * @param {string} options.login - account to invite
 * @param {string} [options.ownerType] - 'User' or 'Organization'
 * @param {Object} options.captions - from buildAccessAnimationCaptions()
 * @param {string} [options.owner] - repository owner shown on the page
 * @param {string} [options.repo] - repository name shown on the page
 * @returns {{markup: string, duration: number, plan: Object}}
 */
export function buildAccessScene({ login, ownerType, captions, owner, repo = 'your-repo' }) {
  const organization = isOrganizationOwner(ownerType);
  owner = owner || (organization ? 'your-org' : 'your-account');
  const plan = buildAccessTimeline({ login, ownerType });
  const confirmLabel = `Add ${login} to ${repo}`;
  const page = organization ? organizationPage({ login, repo, targets: plan.targets, confirmLabel }) : personalPage({ login, repo, targets: plan.targets, confirmLabel });
  const markup = `<div xmlns="http://www.w3.org/1999/xhtml" id="hm-root" lang="${escapeXml(captions.locale || 'en')}"><style>${SCENE_CSS}${OVERLAY_CSS}
${buildTimelineCss(plan)}</style>
${chromeBar({ owner, repo })}${githubHeader({ owner, repo, viewer: organization ? 'your-org-admin' : owner })}${sidebar({ organization })}${page}${overlayMarkup({ captions, plan, organization })}</div>`;
  return { markup, duration: plan.duration, plan };
}

/** The scene as an HTML page (for Chromium). */
export const buildAccessAnimationHtml = options => `<!doctype html><html><head><meta charset="utf-8"/><style>html,body{margin:0;background:${C.canvas}}</style></head><body>${buildAccessScene(options).markup}</body></html>`;

/**
 * The scene as a self-contained animated SVG.
 *
 * @returns {string}
 */
export function buildAccessAnimationSvg(options) {
  const { markup } = buildAccessScene(options);
  const { width, height } = SCENE_SIZE;
  const title = escapeXml(options.captions?.title || 'Give write access');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}"><title>${title}</title><foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>\n`;
}
