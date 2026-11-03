import { assertRouterTaskAuthentication, formatRouterAuthViolation, isRouterAuthGuardRequired, startRouterAuthGuard } from './router-auth-guard.lib.mjs';

/** Preserve ordinary command tags; selected probes receive the admitted env. */
export function createRouterConnectionRunner({ $, tool, useRouter = false, log, env }) {
  return async (strings, ...values) => {
    const nativeEnv = { ...(env ? env() : process.env), ...(useRouter ? { HIVE_MIND_USE_ROUTER: '1' } : {}) };
    assertRouterTaskAuthentication({ tool, env: nativeEnv });
    const selected = isRouterAuthGuardRequired(nativeEnv);
    const launch = selected || env ? $({ env: nativeEnv }) : $;
    const command = launch(strings, ...values);
    if (!selected) return await command;
    const monitored = streamWithRouterAuthenticationGuard({ command, tool, env: nativeEnv, log });
    if (await monitored.first) throw await monitored.close({ cancel: true });
    let result;
    let error;
    let failed = false;
    try {
      result = await command;
    } catch (caught) {
      failed = true;
      error = caught;
    }
    const refusal = await monitored.close({ cancel: failed });
    if (refusal) throw refusal;
    if (failed) throw error;
    return result;
  };
}

/** Async iterator cleanup cannot replace an error thrown by its consumer. */
export function resolveRouterAuthenticationError(error, options) {
  if (error.routerAuthViolation) return error;
  try {
    assertRouterTaskAuthentication(options);
  } catch (authenticationError) {
    return authenticationError;
  }
  return null;
}

/** Arm before any post-command await; close also covers unconsumed output. */
export function streamWithRouterAuthenticationGuard({ command, tool, env, cwd, log }) {
  let stopping = Promise.resolve();
  let stopRequested = false;
  const stopCommand = () => {
    if (!stopRequested) {
      stopRequested = true;
      stopping = Promise.resolve().then(() => command.kill?.('SIGKILL'));
    }
    return stopping;
  };
  const guard = startRouterAuthGuard({
    tool,
    env,
    cwd,
    log,
    onViolation: stopCommand,
  });
  const close = async ({ cancel = false } = {}) => {
    await guard.check();
    if (cancel) stopCommand();
    await stopping.catch(() => {});
    guard.stop();
    return guard.violation ? Object.assign(new Error(formatRouterAuthViolation(guard.violation)), { code: 'ROUTER_AUTH_VIOLATION', routerAuthViolation: guard.violation }) : null;
  };
  const stream = (async function* () {
    let completed = false;
    try {
      await guard.first;
      if (!guard.violation) {
        yield* command.stream();
        completed = true;
      }
    } finally {
      const error = await close({ cancel: !completed });
      // Refuse even when the consumer returns early or an ordinary stream fails.
      // eslint-disable-next-line no-unsafe-finally
      if (error) throw error;
    }
  })();
  return Object.assign(stream, { close, first: guard.first });
}
