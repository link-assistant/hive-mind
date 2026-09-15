const ROOT_FIELDS = new Set(['issues']);
const ITEM_FIELDS = new Set(['issue', 'expectedUpdatedAt', 'type', 'addLabels', 'removeLabels', 'documentationImpact', 'confidence', 'reason']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);

const assertPlainObject = (value, description) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${description} must be an object`);
};

const rejectUnexpectedFields = (value, allowed, description) => {
  const unexpected = Object.keys(value).filter(key => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${description} has unexpected field(s): ${unexpected.join(', ')}`);
};

const requireFields = (value, required, description) => {
  const missing = [...required].filter(key => !Object.hasOwn(value, key));
  if (missing.length > 0) throw new Error(`${description} is missing field(s): ${missing.join(', ')}`);
};

const requireStringArray = (value, description) => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) throw new TypeError(`${description} must be an array of non-empty strings`);
  if (new Set(value).size !== value.length) throw new Error(`${description} contains duplicate values`);
};

const normalizedLabels = issue => (Array.isArray(issue?.labels) ? issue.labels : []);
const labelNames = issue => new Set(normalizedLabels(issue).map(label => label.name));

/**
 * Validate the model plan against the immutable collection snapshot and
 * resolve human-readable taxonomy names to GitHub node IDs.
 */
export function validateOrganizationPlan(rawPlan, { issues, issueTypes = [], labels = [] }) {
  assertPlainObject(rawPlan, 'Organization plan');
  rejectUnexpectedFields(rawPlan, ROOT_FIELDS, 'Organization plan');
  requireFields(rawPlan, ROOT_FIELDS, 'Organization plan');
  if (!Array.isArray(rawPlan.issues)) throw new TypeError('Organization plan issues must be an array');

  const issueByNumber = new Map(issues.map(issue => [issue.number, issue]));
  const typeByName = new Map(issueTypes.map(type => [type.name, type]));
  const labelByName = new Map(labels.map(label => [label.name, label]));
  const seen = new Set();
  const validated = [];

  for (const item of rawPlan.issues) {
    assertPlainObject(item, 'Organization plan item');
    rejectUnexpectedFields(item, ITEM_FIELDS, `Organization plan item #${item.issue ?? '?'}`);
    requireFields(item, ITEM_FIELDS, `Organization plan item #${item.issue ?? '?'}`);
    if (!Number.isInteger(item.issue) || item.issue < 1) throw new TypeError('Organization plan issue must be a positive integer');
    if (seen.has(item.issue)) throw new Error(`Duplicate issue #${item.issue} in organization plan`);
    seen.add(item.issue);

    const source = issueByNumber.get(item.issue);
    if (!source) throw new Error(`Issue #${item.issue} is not in the collected OPEN issue scope`);
    if (typeof item.expectedUpdatedAt !== 'string' || item.expectedUpdatedAt !== source.updatedAt) throw new Error(`Issue #${item.issue} expectedUpdatedAt does not match the collected snapshot`);
    if (item.type !== null && (typeof item.type !== 'string' || !typeByName.has(item.type))) throw new Error(`Unknown issue type "${item.type}" for issue #${item.issue}`);
    requireStringArray(item.addLabels, `Issue #${item.issue} addLabels`);
    requireStringArray(item.removeLabels, `Issue #${item.issue} removeLabels`);
    if (typeof item.documentationImpact !== 'boolean') throw new TypeError(`Issue #${item.issue} documentationImpact must be boolean`);
    if (!CONFIDENCE.has(item.confidence)) throw new Error(`Issue #${item.issue} confidence must be high, medium, or low`);
    if (typeof item.reason !== 'string' || item.reason.trim().length === 0 || item.reason.length > 1000) throw new Error(`Issue #${item.issue} reason must be 1-1000 characters`);

    const currentLabels = labelNames(source);
    for (const name of [...item.addLabels, ...item.removeLabels]) {
      if (!labelByName.has(name)) throw new Error(`Unknown label "${name}" for issue #${item.issue}`);
    }
    for (const name of item.removeLabels) {
      if (!currentLabels.has(name)) throw new Error(`Issue #${item.issue} cannot remove label "${name}" because it is not currently applied`);
      if (item.addLabels.includes(name)) throw new Error(`Issue #${item.issue} cannot both add and remove label "${name}"`);
    }

    validated.push({
      ...item,
      reason: item.reason.trim(),
      source,
      typeId: item.type === null ? null : typeByName.get(item.type).id,
      addLabelIds: item.addLabels.map(name => labelByName.get(name).id),
      removeLabelIds: item.removeLabels.map(name => labelByName.get(name).id),
    });
  }

  const missing = issues.map(issue => issue.number).filter(number => !seen.has(number));
  if (missing.length > 0) throw new Error(`Organization plan is missing issue(s): ${missing.map(number => `#${number}`).join(', ')}`);
  return validated;
}

const describeType = type => type?.name || null;

function isSafePartialProgress(item, before, after) {
  if (before.title !== after.title || before.body !== after.body) return false;
  const beforeLabels = labelNames(before);
  const afterLabels = labelNames(after);
  const added = [...afterLabels].filter(name => !beforeLabels.has(name));
  const removed = [...beforeLabels].filter(name => !afterLabels.has(name));
  const beforeType = describeType(before.issueType);
  const afterType = describeType(after.issueType);
  const typeChanged = beforeType !== afterType;
  if (typeChanged && afterType !== item.type) return false;
  if (added.some(name => !item.addLabels.includes(name))) return false;
  if (removed.some(name => !item.removeLabels.includes(name))) return false;
  return typeChanged || added.length > 0 || removed.length > 0;
}

export function computeOrganizationDiff(item, currentIssue) {
  const currentNames = labelNames(currentIssue);
  const addLabels = item.addLabels.map((name, index) => ({ id: item.addLabelIds[index], name })).filter(label => !currentNames.has(label.name));
  const removeLabels = item.removeLabels.map((name, index) => ({ id: item.removeLabelIds[index], name })).filter(label => currentNames.has(label.name));
  const currentType = describeType(currentIssue.issueType);
  const type = item.type !== null && item.type !== currentType ? { from: currentType, to: item.type, id: item.typeId } : null;
  return { changed: Boolean(type || addLabels.length || removeLabels.length), type, addLabels, removeLabels };
}

export function formatOrganizationDiff(diff) {
  if (!diff?.changed) return 'no metadata changes';
  const parts = [];
  if (diff.type) parts.push(`type: ${diff.type.from || 'none'} → ${diff.type.to}`);
  if (diff.addLabels.length) parts.push(`add: ${diff.addLabels.map(label => label.name).join(', ')}`);
  if (diff.removeLabels.length) parts.push(`remove: ${diff.removeLabels.map(label => label.name).join(', ')}`);
  return parts.join('; ');
}

const countEntries = entries => ({
  scanned: entries.length,
  changed: entries.filter(entry => entry.status === 'changed' || entry.status === 'planned').length,
  unchanged: entries.filter(entry => entry.status === 'unchanged').length,
  stale: entries.filter(entry => entry.status === 'stale').length,
  errors: entries.filter(entry => entry.status === 'error').length,
});

async function applyOne({ client, item, initial, maxAttempts }) {
  let current = await client.fetchIssue(item.issue);
  if (!current) return { issue: item.issue, url: initial.url, status: 'error', message: 'Issue is no longer open' };
  if (current.updatedAt !== item.expectedUpdatedAt) {
    return { issue: item.issue, url: initial.url, status: 'stale', message: `Issue #${item.issue} changed after classification; skipped` };
  }

  const originalDiff = computeOrganizationDiff(item, current);
  if (!originalDiff.changed) return { issue: item.issue, url: initial.url, status: 'unchanged', summary: formatOrganizationDiff(originalDiff), diff: originalDiff };

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = computeOrganizationDiff(item, current);
    if (!remaining.changed) return { issue: item.issue, url: initial.url, status: 'changed', summary: formatOrganizationDiff(originalDiff), diff: originalDiff, attempts: attempt - 1 };
    try {
      await client.updateIssue(item.issue, remaining, current);
      return { issue: item.issue, url: initial.url, status: 'changed', summary: formatOrganizationDiff(originalDiff), diff: originalDiff, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        const refreshed = await client.fetchIssue(item.issue);
        if (!refreshed) break;
        if (refreshed.updatedAt !== current.updatedAt && !isSafePartialProgress(item, current, refreshed)) {
          return { issue: item.issue, url: initial.url, status: 'stale', message: `Issue #${item.issue} changed during an update retry; remaining changes were skipped`, diff: originalDiff };
        }
        current = refreshed;
      }
    }
  }
  return { issue: item.issue, url: initial.url, status: 'error', message: `Issue #${item.issue} update failed: ${lastError?.message || 'unknown error'}`, diff: originalDiff };
}

/** Apply validated metadata updates in bounded concurrent batches. */
export async function applyOrganizationPlan({ client, plan, issues, dryRun = false, batchSize = 10, maxAttempts = 3 }) {
  const issueByNumber = new Map(issues.map(issue => [issue.number, issue]));
  if (dryRun) {
    const entries = plan.map(item => {
      const issue = issueByNumber.get(item.issue);
      const diff = computeOrganizationDiff(item, issue);
      return { issue: item.issue, url: issue.url, status: diff.changed ? 'planned' : 'unchanged', summary: formatOrganizationDiff(diff), diff };
    });
    return { entries, counts: countEntries(entries) };
  }

  const entries = [];
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 10;
  for (let offset = 0; offset < plan.length; offset += size) {
    const batch = plan.slice(offset, offset + size);
    const settled = await Promise.all(
      batch.map(async item => {
        const initial = issueByNumber.get(item.issue);
        try {
          return await applyOne({ client, item, initial, maxAttempts });
        } catch (error) {
          return { issue: item.issue, url: initial?.url, status: 'error', message: `Issue #${item.issue} update failed: ${error.message}` };
        }
      })
    );
    entries.push(...settled);
  }
  return { entries, counts: countEntries(entries) };
}

/** Compare desired final metadata with a freshly collected OPEN issue set. */
export function verifyOrganizationPlan({ plan, issues }) {
  const currentByNumber = new Map(issues.map(issue => [issue.number, issue]));
  const errors = [];
  for (const item of plan) {
    const current = currentByNumber.get(item.issue);
    if (!current) {
      errors.push(`Issue #${item.issue} is no longer open and could not be verified`);
      continue;
    }
    const mismatches = [];
    if (item.type !== null && describeType(current.issueType) !== item.type) mismatches.push(`type is ${describeType(current.issueType) || 'none'}, expected ${item.type}`);
    const expectedLabels = labelNames(item.source);
    for (const name of item.removeLabels) expectedLabels.delete(name);
    for (const name of item.addLabels) expectedLabels.add(name);
    const actualLabels = labelNames(current);
    const missingLabels = [...expectedLabels].filter(name => !actualLabels.has(name));
    const unexpectedLabels = [...actualLabels].filter(name => !expectedLabels.has(name));
    if (missingLabels.length) mismatches.push(`missing labels: ${missingLabels.join(', ')}`);
    if (unexpectedLabels.length) mismatches.push(`unexpected labels: ${unexpectedLabels.join(', ')}`);
    if (mismatches.length) errors.push(`Issue #${item.issue} metadata does not match the plan: ${mismatches.join('; ')}`);
  }
  return { ok: errors.length === 0, errors };
}
