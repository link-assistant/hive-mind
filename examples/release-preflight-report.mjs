#!/usr/bin/env node

/**
 * Issue #2221 — ask, before releasing anything, whether this machine could.
 *
 * Run: node examples/release-preflight-report.mjs [image-reference ...]
 *
 * With no arguments it reports on the images this repository publishes. Every
 * probe is the real request the release would make -- an opened-and-cancelled
 * blob upload session for write access, an unauthenticated manifest GET for
 * what a consumer would get -- so this is the same answer the pipeline gets,
 * from your shell, before you push:
 *
 *   DOCKERHUB_USERNAME=you DOCKERHUB_TOKEN=... node examples/release-preflight-report.mjs
 *
 * Without credentials in the environment the write probes report
 * `missing-credentials`, and outside GitHub Actions the OIDC probe reports
 * `missing-permission` -- both of which are the useful answer when you
 * expected otherwise. Nothing is ever stored in a registry by this script.
 */

import { buildTargets, renderSummary, runPreflight } from '../scripts/preflight-credentials.lib.mjs';

const references = process.argv.slice(2);
const env = references.length > 0 ? { ...process.env, PREFLIGHT_PUSH_TARGETS: references.join(' '), PREFLIGHT_PULL_TARGETS: references.join(' ') } : process.env;

// `report`, never `release`: this script answers a question, it does not gate
// anything, so it must not exit non-zero on a finding.
const result = await runPreflight({ mode: 'report', targets: buildTargets({ env }), env });

console.log(renderSummary(result));
console.log(result.verified > 0 ? `\n${result.verified} capabilit${result.verified === 1 ? 'y was' : 'ies were'} established by an actual request.` : '\nNothing was verified — this is not a pass, it is an absence of evidence.');
