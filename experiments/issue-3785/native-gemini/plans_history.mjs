// Appended to the checked native history helper by the disposable plan stage.
const nativePlanDirectories = new Map();

function validNativePlanName(relative) {
  if (typeof relative !== 'string' || /[\\\0\r\n]/u.test(relative)) return false;
  const parts = relative.split('/');
  return parts.length >= 1 && parts.length <= 8 && parts.every(name => !name.startsWith('.publish-') && !name.startsWith('.history-')) && parts.slice(0, -1).every(name => /^[A-Za-z0-9_.-]{1,200}$/u.test(name) && !['.', '..'].includes(name)) && parts.at(-1).endsWith('.md') && Buffer.byteLength(parts.at(-1)) <= 255 && Buffer.from(relative).toString('utf8') === relative;
}

export function nativeGeminiPlanPolicyPattern(plans) {
  assertNativeGeminiHistoryCurrent();
  if (!nativePlanDirectories.has(plans)) throw refuse();
  const encoded = JSON.stringify(plans + path.sep).slice(1, -1);
  const escaped = encoded.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`\\x00"file_path":"${escaped}[\\w-]+\\.md"\\x00`, 'u');
}

export function nativeGeminiPlansDirectory(temporary, session) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    assertNativeGeminiHistoryCurrent();
    const project = projectTemps.get(temporary);
    if (!project || (session !== undefined && (typeof session !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/u.test(session)))) throw refuse();
    const scope = `hive-native-plans:${digest(session ?? '')}`;
    const components = ['projects', project.identifier, 'plans', `session-${digest(session ?? '')}`];
    const parent = directory(components);
    const named = path.join(authority.selected, ...components);
    if (!nativePlanDirectories.has(named) && nativePlanDirectories.size >= 64) throw refuse();
    nativePlanDirectories.set(named, { temporary, scope, parent });
    readNativeGeminiPromptHistory(temporary);
    return named;
  } catch {
    throw refuse();
  }
}

function nativePlanLocation(file) {
  assertNativeGeminiHistoryCurrent();
  if (typeof file !== 'string' || !path.isAbsolute(file) || !within(authority.selected, path.resolve(file))) return undefined;
  const parts = path.relative(authority.selected, file).split(path.sep);
  if (parts[0] !== 'projects' || parts[2] !== 'plans') return undefined;
  if (file !== path.normalize(file) || parts.length < 5 || !validNativePlanName(parts.slice(4).join('/'))) throw refuse();
  const context = nativePlanDirectories.get(path.join(authority.selected, ...parts.slice(0, 4)));
  const name = parts.at(-1);
  if (!context) throw refuse();
  return { context, name, relative: parts.slice(4).join('/'), directories: parts.slice(0, -1) };
}

function nativePlanRecords(records, context) {
  const plans = new Map();
  for (const entry of records) {
    if (entry.type !== 'plan-document') continue;
    if (!/^hive-native-plans:[a-f0-9]{64}$/u.test(entry.sessionId)) throw refuse();
    const plan = JSON.parse(entry.message);
    if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).length !== 3 || !validNativePlanName(plan.name) || typeof plan.content !== 'string' || Buffer.byteLength(plan.content) > LIMIT || Buffer.from(plan.content).toString('utf8') !== plan.content || plan.hash !== digest(plan.content)) throw refuse();
    if (entry.sessionId === context.scope) plans.set(plan.name, { ...plan, revision: entry.messageId });
    if (plans.size > 1024) throw refuse();
  }
  return plans;
}

function nativePlanSnapshot(location, parent, plans) {
  const saved = plans.get(location.relative);
  const target = { target: `${parent.anchor}/${location.name}` };
  const bytes = snapshot(target, true);
  if ((saved === undefined && bytes !== null) || (saved !== undefined && bytes !== saved.content)) throw refuse();
  return { saved, bytes, target, version: bytes === null ? null : version(checkedFile(target)) };
}

export function readNativeGeminiPlan(file) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    const location = nativePlanLocation(file);
    if (!location) return undefined;
    return locked(location.context.parent, () => {
      const plans = nativePlanRecords(readNativeGeminiPromptHistory(location.context.temporary), location.context);
      let parent;
      try {
        parent = directory(location.directories, false);
      } catch (error) {
        if (plans.has(location.relative) || error.code !== 'ENOENT') throw refuse();
        throw error;
      }
      const saved = nativePlanSnapshot(location, parent, plans);
      if (saved.bytes === null) {
        const missing = new Error('Native plan file does not exist.');
        missing.code = 'ENOENT';
        throw missing;
      }
      return saved.bytes;
    });
  } catch (error) {
    if (error.code === 'ENOENT' && !failed) throw error;
    throw refuse();
  }
}

export function writeNativeGeminiPlan(file, content) {
  if (!nativeGeminiHistorySelected()) return false;
  try {
    const location = nativePlanLocation(file);
    if (!location) return false;
    if (typeof content !== 'string' || Buffer.byteLength(content) > LIMIT || !isUtf8(Buffer.from(content)) || Buffer.from(content).toString('utf8') !== content) throw refuse();
    locked(location.context.parent, current => {
      const plans = nativePlanRecords(readNativeGeminiPromptHistory(location.context.temporary), location.context);
      const parent = directory(location.directories);
      const before = nativePlanSnapshot(location, parent, plans);
      const unchanged = () => {
        const info = checkedFile(before.target, true);
        if ((info === null ? null : version(info)) !== before.version) throw refuse();
      };
      unchanged();
      appendNativeGeminiPromptHistory(
        location.context.temporary,
        {
          sessionId: location.context.scope,
          messageId: 0,
          type: 'plan-document',
          message: JSON.stringify({ name: location.relative, content, hash: digest(content) }),
          timestamp: new Date().toISOString(),
        },
        records => {
          const previous = nativePlanRecords(records, location.context).get(location.relative);
          if (previous?.revision !== before.saved?.revision) throw refuse();
          unchanged();
        }
      );
      publish(parent, location.name, content, current, before.bytes !== null, unchanged);
      current();
    });
    return true;
  } catch {
    throw refuse();
  }
}
