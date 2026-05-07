// Resolve use-m's yargs import to the fresh parser factory.
//
// In the use-m yargs@17.7.2 shape, the module object is the factory that
// creates independent parser instances, while module.default is a singleton
// wrapper. Reusing the singleton accumulates options and duplicates choice
// values in validation errors.
export function resolveYargsFactory(yargsModule) {
  if (typeof yargsModule === 'function' && typeof yargsModule.getInternalMethods === 'function') {
    return yargsModule;
  }

  const candidate = yargsModule?.default || yargsModule;
  if (typeof candidate !== 'function') {
    throw new TypeError('Unable to resolve yargs factory from imported module');
  }
  return candidate;
}
