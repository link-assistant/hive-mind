import { assertRouterTaskAuthentication, formatRouterAuthViolation, startRouterAuthGuard } from './router-auth-guard.lib.mjs';

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
  return Object.assign(stream, { close });
}
