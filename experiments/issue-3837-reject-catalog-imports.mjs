/** CLI early-exit probe: fail if startup tries to load the prompt catalog parser. */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'lino-i18n' || specifier.startsWith('lino-i18n/')) throw new Error('Early CLI exit must not load prompt catalogs');
    return nextResolve(specifier, context);
  },
});
