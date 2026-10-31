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

/** Keep monitoring and the final security decision intact when a stream fails. */
export async function* streamWithRouterAuthenticationGuard({ command, tool, env, cwd, log }) {
  let stopping = Promise.resolve();
  const guard = startRouterAuthGuard({
    tool,
    env,
    cwd,
    log,
    onViolation: () => {
      stopping = Promise.resolve().then(() => command.kill?.('SIGKILL'));
      return stopping;
    },
  });
  try {
    await guard.first;
    if (!guard.violation) yield* command.stream();
  } finally {
    guard.stop();
    await guard.check();
    await stopping.catch(() => {});
    // Refuse even when the consumer returns early or an ordinary stream fails.
    // eslint-disable-next-line no-unsafe-finally
    if (guard.violation) throw Object.assign(new Error(formatRouterAuthViolation(guard.violation)), { code: 'ROUTER_AUTH_VIOLATION', routerAuthViolation: guard.violation });
  }
}
