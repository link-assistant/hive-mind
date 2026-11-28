import { isDeepStrictEqual } from 'node:util';

/** Schema versions belong to the shared state document, independent of the link-cli version. */
export const BOT_STATE_VERSION = 1;

// Version 0 is the state envelope without a schema marker. Future migrations can
// use reversible field additions and renames or supply an explicit down step.
const migrations = [{ up: [{ add: 'version', value: 1 }] }];

export function parseBotStateVersion(value) {
  const version = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(version) || version < 0 || version > BOT_STATE_VERSION) throw new Error(`Unsupported bot state schema version ${JSON.stringify(value)} (supported: 0–${BOT_STATE_VERSION})`);
  return version;
}

export const getBotStateVersion = state => (Object.hasOwn(state, 'version') ? parseBotStateVersion(state.version) : 0);

/** At startup, a configured target can move in either direction. `off` preserves the stored version. */
export function resolveBotStateMigrationTarget(env = process.env) {
  const value = String(env.HIVE_MIND_STATE_SCHEMA_TARGET ?? '').trim();
  return value === 'off' ? undefined : parseBotStateVersion(value || BOT_STATE_VERSION);
}

function reverseOperations(up) {
  return [...up].reverse().map(operation => {
    if (Object.hasOwn(operation, 'add')) return { remove: operation.add, value: operation.value };
    if (Object.hasOwn(operation, 'rename')) return { rename: operation.to, to: operation.rename };
    throw new Error('A destructive bot state migration requires an explicit down step');
  });
}

export function applyBotStateMigration(state, { up, down }, direction) {
  const operations = direction === 'up' ? up : (down ?? reverseOperations(up));
  const result = { ...state };
  for (const operation of operations) {
    if (Object.hasOwn(operation, 'remove')) {
      if (!Object.hasOwn(result, operation.remove) || (Object.hasOwn(operation, 'value') && !isDeepStrictEqual(result[operation.remove], operation.value))) throw new Error(`Cannot remove field ${operation.remove} from bot state`);
      delete result[operation.remove];
      continue;
    }
    const field = operation.to ?? operation.add;
    if (Object.hasOwn(result, field)) throw new Error(`Bot state migration would overwrite field ${field}`);
    if (Object.hasOwn(operation, 'rename') && !Object.hasOwn(result, operation.rename)) throw new Error(`Cannot rename missing bot state field ${operation.rename}`);
    Object.defineProperty(result, field, { value: operation.rename === undefined ? operation.value : result[operation.rename], enumerable: true, writable: true, configurable: true });
    if (operation.rename !== undefined) delete result[operation.rename];
  }
  return result;
}

export function migrateBotState(state, targetVersion) {
  const target = parseBotStateVersion(targetVersion);
  let result = state;
  let version = getBotStateVersion(state);
  while (version !== target) {
    const up = version < target;
    result = applyBotStateMigration(result, migrations[up ? version : version - 1], up ? 'up' : 'down');
    version += up ? 1 : -1;
    if (getBotStateVersion(result) !== version) throw new Error(`Bot state migration did not produce schema ${version}`);
  }
  return result;
}
