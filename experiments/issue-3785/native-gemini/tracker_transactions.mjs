// Keep the actual native async validators tied to their checked commit.
import { AsyncLocalStorage } from 'node:async_hooks';

const operations = new AsyncLocalStorage();
const refusal = () => new Error('Gemini canonical conversation history is unavailable or unsafe.');

export function nativeGeminiTrackerOperation(service, action) {
  return operations.run({ service, observed: new Map() }, action);
}

export function observeNativeGeminiTracker(service, id, revision) {
  const operation = operations.getStore();
  if (!operation || operation.service !== service) return;
  if (operation.observed.has(id) && operation.observed.get(id) !== revision) throw refusal();
  operation.observed.set(id, revision);
}

export function assertNativeGeminiTrackerObservations(service, current) {
  const operation = operations.getStore();
  if (!operation || operation.service !== service) return;
  for (const [id, revision] of operation.observed) {
    if (current.get(id)?.revision !== revision) throw refusal();
  }
}
