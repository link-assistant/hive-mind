// Minimal reproduction: does importing the auto-merge guards module alone throw a TDZ error? (issue #3469 R3)
const which = process.argv[2] || 'guards';
if (which === 'guards') await import('../src/solve.auto-merge-guards.lib.mjs');
else if (which === 'draft') await import('../src/pr-draft-state.lib.mjs');
else {
  await import('../src/pr-draft-state.lib.mjs');
  await import('../src/solve.auto-merge-guards.lib.mjs');
}
console.log('ok', which);
