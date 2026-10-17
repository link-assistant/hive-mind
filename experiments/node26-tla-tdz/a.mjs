// "guards": two top-level dynamic imports. By the second one the entry has already
// started evaluating b (which waits on c's top-level await), so b is "evaluating-async".
await import('./d.mjs');
const { x } = await import('./b.mjs');
export const a = () => x;
