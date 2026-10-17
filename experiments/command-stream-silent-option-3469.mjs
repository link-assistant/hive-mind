const { $ } = await import(process.argv[2]);
const r = await $({ silent: true })`echo mirrored-with-silent`;
const q = await $({ mirror: false, capture: true })`echo quiet-probe`;
console.error('captured:', JSON.stringify(r.stdout), JSON.stringify(q.stdout));
