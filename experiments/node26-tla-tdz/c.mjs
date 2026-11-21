// "config": a module whose top-level await waits on a macrotask (like use-m loading a package).
await new Promise(resolve => setTimeout(resolve, 10));
export const c = 1;
