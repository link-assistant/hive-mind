#!/usr/bin/env node

/**
 * Re-check the lychee failures where no host ever answered.
 *
 * lychee's `--max-retries` cannot retry a connection reset during connect
 * (lycheeverse/lychee#2297: the error is classified by its phase, and the
 * connect phase is answered `false`), so a healthy URL that answers a RST —
 * a normal event for a rate-limiting or load-shedding host seen from a CI
 * address range — is reported as broken without a single retry. This script
 * asks those URLs again, outside lychee.
 *
 * The rule that keeps this from hiding real breakage: a failure carrying a
 * status code means a host answered, and that answer is final — a 404 is
 * never re-checked.
 *
 * Environment variables:
 *   - LYCHEE_OUTPUT: Path to the lychee markdown report
 *     (default: lychee/out.md)
 *   - RECOVERED_OUTPUT: Where to write the URLs the re-check found healthy
 *     (default: lychee/recovered.txt)
 *   - RECHECK_BUDGET_SECONDS: Total wall-clock budget for the re-check
 *     (default: 240; must expire before the job's 10-minute cap)
 *   - RECHECK_WAIT_MS: Initial wait between rounds; doubles every round
 *     (default: 2000)
 *
 * GitHub Actions outputs:
 *   - all_recovered: 'true' when the report contained nothing but unanswered
 *     failures and every one of them answered healthy on re-check. Consumers
 *     must test `!= 'true'`, never `== 'false'`: a
 *     skipped or crashed step leaves the output empty, and only the `!=`
 *     form fails safe.
 *
 * Exit codes:
 *   - 0 in every case. This script downgrades failures; it never raises
 *     them, so a bug here cannot turn a green run red.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Environment-derived settings are read inside main(), not here: the Deno
// test leg imports this module under `--allow-read` only, and any
// module-scope process.env access would throw NotCapable at import time.
const BUDGET_SECONDS_DEFAULT = 240;
const INITIAL_WAIT_MS_DEFAULT = 2000;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT_DEFAULT = 'lychee';
// lychee's documented default --accept list; used when the workflow does not
// set the flag. tests/recheck-broken-links.test.js reads this file and the
// workflow together, so the two cannot drift apart.
const ACCEPT_DEFAULT = '100..=103,200..=299';

/**
 * Split the lychee markdown report into per-failure records.
 *
 * A failure is "answered" when a numeric status marker is present ([404])
 * or the detail says "Rejected status code" — a host answered, and the
 * answer is final. Everything else ([ERROR], [TIMEOUT], [UNKNOWN]) is a
 * failure where no host ever answered.
 * @param {string} content - The markdown content from lychee
 * @returns {Array<{marker: string, url: string, detail: string, answered: boolean}>}
 */
export function parseLycheeFailures(content) {
  const failures = [];
  const entryPattern =
    /^\s*(?:\*|-)\s+\[([^\]]+)\]\s+<?([^\s>|)]+)>?(?:\s+\(at [^)]*\))?\s*\|?\s*(.*)$/gim;

  let match;
  while ((match = entryPattern.exec(content)) !== null) {
    const marker = match[1].trim();
    const url = match[2].trim().replace(/[.,;!?]+$/, '');
    const detail = match[3].trim();

    if (!url) {
      continue;
    }

    const answered =
      /^\d{3}$/.test(marker) || /rejected status code/i.test(detail);

    failures.push({ marker, url, detail, answered });
  }

  return failures;
}

/**
 * Build an "is this status accepted" predicate from a lychee --accept list
 * such as "100..=103,200..=299,429" (spaces tolerated).
 * @param {string} spec - The lychee --accept list
 * @returns {(status: number) => boolean}
 */
export function parseAcceptRanges(spec) {
  const accepted = [];

  for (const part of spec.split(',')) {
    const trimmed = part.trim();

    if (!trimmed) {
      continue;
    }

    const range = trimmed.match(/^(\d+)\.\.=(\d+)$/);

    if (range) {
      for (
        let status = Number(range[1]);
        status <= Number(range[2]);
        status += 1
      ) {
        accepted.push(status);
      }
      continue;
    }

    if (/^\d{3}$/.test(trimmed)) {
      accepted.push(Number(trimmed));
    }
  }

  return (status) => accepted.includes(status);
}

/**
 * Extract the --accept list and --user-agent the lychee step runs with, so
 * the re-check judges a URL by the same rules the checker used.
 * @param {string} workflowText - The links.yml content
 * @returns {{accept: string, userAgent: string}}
 */
export function extractLycheeRequestOptions(workflowText) {
  const accept = workflowText.match(/--accept[=\s]+["']?([^\s"']+)["']?/);
  const userAgent = workflowText.match(
    /--user-agent[=\s]+["']?([^\s"']+)["']?/
  );

  return {
    accept: accept ? accept[1] : ACCEPT_DEFAULT,
    userAgent: userAgent ? userAgent[1] : USER_AGENT_DEFAULT,
  };
}

/**
 * Ask every URL once more, round-robin with a doubling wait, until everything
 * either answers accepted or the budget runs out. Any answer is final: an
 * accepted status recovers the URL, a rejected status fails it for good, and
 * only a URL that keeps refusing to answer is retried.
 * @param {string[]} urls - The URLs that never got an answer from lychee
 * @param {{accept: string, userAgent: string, budgetSeconds?: number, initialWaitMs?: number, fetchImpl?: typeof fetch}} options
 * @returns {Promise<{recovered: string[], stillBroken: Array<{url: string, status: number|null, reason: string}>}>}
 */
export async function recheckUnanswered(urls, options) {
  const accept = parseAcceptRanges(options.accept);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const budgetMs = (options.budgetSeconds ?? BUDGET_SECONDS_DEFAULT) * 1000;
  const startedAt = Date.now();
  const initialWaitMs = options.initialWaitMs ?? INITIAL_WAIT_MS_DEFAULT;
  let waitMs = initialWaitMs;

  const recovered = [];
  const rejected = [];
  let pending = [...new Set(urls)];

  while (pending.length > 0 && Date.now() - startedAt < budgetMs) {
    if (waitMs !== initialWaitMs) {
      const elapsed = Date.now() - startedAt;

      if (elapsed + waitMs > budgetMs) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, waitMs));
      waitMs *= 2;
    }

    const stillPending = [];

    for (const url of pending) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );
      let response;

      try {
        response = await fetchImpl(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'user-agent': options.userAgent },
        });
      } catch {
        // No host answered this round; it stays eligible for the next one.
        stillPending.push(url);
        continue;
      } finally {
        clearTimeout(timeoutId);
      }

      if (accept(response.status)) {
        recovered.push(url);
      } else {
        rejected.push({
          url,
          status: response.status,
          reason: `answered ${response.status}, which lychee does not accept`,
        });
      }
    }

    pending = stillPending;
  }

  return {
    recovered,
    stillBroken: [
      ...rejected,
      ...pending.map((url) => ({
        url,
        status: null,
        reason: 'no answer within the re-check budget',
      })),
    ],
  };
}

/**
 * Whether the re-check cleared every failure in the complete lychee report.
 * Keeping this as a report-level predicate prevents a recovered transient
 * error from hiding an answered failure such as a 404.
 * @param {{finalFailureCount: number, stillBrokenCount: number, unansweredCount: number, recoveredCount: number}} counts
 * @returns {boolean}
 */
export function allFailuresRecovered(counts) {
  return (
    counts.finalFailureCount === 0 &&
    counts.stillBrokenCount === 0 &&
    counts.unansweredCount > 0 &&
    counts.recoveredCount === counts.unansweredCount
  );
}

async function main() {
  const lycheeOutput = process.env.LYCHEE_OUTPUT || 'lychee/out.md';
  const recoveredOutput =
    process.env.RECOVERED_OUTPUT || 'lychee/recovered.txt';
  const workflowText = readFileSync('.github/workflows/links.yml', 'utf8');
  const options = extractLycheeRequestOptions(workflowText);
  const content = readFileSync(lycheeOutput, 'utf8');
  const failures = parseLycheeFailures(content);

  const finalFailures = failures.filter(
    (failure) => failure.answered || !/^https?:\/\//i.test(failure.url)
  );
  const unanswered = failures
    .filter((failure) => !failure.answered && /^https?:\/\//i.test(failure.url))
    .map((failure) => failure.url);

  console.log(
    `Re-check: ${failures.length} lychee failure(s), ${finalFailures.length} answered and final, ${unanswered.length} never got an answer`
  );

  if (unanswered.length === 0) {
    console.log('Re-check: nothing to re-ask.');
    return;
  }

  const result = await recheckUnanswered(unanswered, {
    ...options,
    budgetSeconds: Number(
      process.env.RECHECK_BUDGET_SECONDS || BUDGET_SECONDS_DEFAULT
    ),
    initialWaitMs: Number(
      process.env.RECHECK_WAIT_MS || INITIAL_WAIT_MS_DEFAULT
    ),
  });

  for (const url of result.recovered) {
    console.log(
      `::notice::${url} never answered lychee but answers ${options.accept} now -- not a broken link`
    );
  }

  if (result.recovered.length > 0) {
    writeFileSync(recoveredOutput, `${result.recovered.join('\n')}\n`);
  }

  console.log(
    `Re-check finished: ${result.recovered.length} recovered, ${result.stillBroken.length} still without an answer`
  );

  if (
    allFailuresRecovered({
      finalFailureCount: finalFailures.length,
      stillBrokenCount: result.stillBroken.length,
      unansweredCount: unanswered.length,
      recoveredCount: result.recovered.length,
    })
  ) {
    appendFileSync(
      process.env.GITHUB_OUTPUT || '/dev/null',
      'all_recovered=true\n'
    );
  }
}

// The re-check only ever downgrades failures, so any crash here must not
// mask itself as a verdict: exit 0 in every case.
const isDirectExecution =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`Re-check crashed (treating as no recovery): ${error}`);
    process.exit(0);
  });
}
