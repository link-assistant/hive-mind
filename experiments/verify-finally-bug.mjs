const state = { mode: 'off' };

function withConcurrency(override, fn) {
  const saved = state.mode;
  try {
    state.mode = override;
    return fn();
  } finally {
    state.mode = saved;
  }
}

await withConcurrency('per-free-model-one-at-a-time', async () => {
  console.log('inside async fn, state.mode =', state.mode);
  // Simulate async work
  await new Promise(r => setTimeout(r, 0));
  console.log('after await, state.mode =', state.mode);
});
console.log('after withConcurrency, state.mode =', state.mode);
