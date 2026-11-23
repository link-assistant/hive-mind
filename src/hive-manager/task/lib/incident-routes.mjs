import { failureKind } from './inspection.mjs';

export function validateHostSignature(signature, backend, exitCode) {
  if (signature !== undefined && (backend !== 'docker' || exitCode < 128 || !['host-reboot', 'host-reset', 'daemon-restart'].includes(signature))) {
    throw new Error('Use a journal correlation from deploy diagnose for a signal-range Docker task exit.');
  }
}

export function validateIncidentRoutes(routes) {
  if (!Array.isArray(routes)) throw new Error('Incident routes must be a JSON array.');
  const seen = new Set();
  for (const route of routes) {
    if (!route || !['docker', 'screen', 'tmux', 'ssh', 'local'].includes(route.backend) || !Number.isSafeInteger(route.exitCode) || route.exitCode < 1 || typeof route.kind !== 'string' || !Number.isSafeInteger(route.issue) || route.issue < 1 || (route.signature !== undefined && (typeof route.signature !== 'string' || !/^[a-z0-9-]+$/.test(route.signature)))) {
      throw new Error('Each route needs the backend, kind and exitCode from a failure group and a positive issue number.');
    }
    const signature = JSON.stringify([route.backend, route.kind, route.exitCode, route.signature]);
    if (seen.has(signature)) throw new Error('Specify at most one issue per failure group and signature.');
    seen.add(signature);
  }
  return routes.map(({ backend, kind, exitCode, issue, signature }) => ({ backend, kind, exitCode, issue, signature }));
}

export function routedIssue(routes, backend, attempt, signature) {
  const kind = failureKind(attempt);
  const matches = routes.filter(route => route.backend === backend && route.exitCode === attempt.exitCode && route.kind === kind);
  return (matches.find(route => route.signature !== undefined && route.signature === signature) ?? matches.find(route => route.signature === undefined))?.issue;
}
