#!/usr/bin/env node

/**
 * Obtain and verify the Formal AI binary one draft attempt selected (issue #3909).
 *
 * Run by the `binary` job of `.github/workflows/formal-ai-draft.yml`; the
 * attempt identity comes from `FORMAL_AI_DRAFT_ATTEMPT_IDENTITY` (the `select`
 * job's output) and is re-checked against its own id before use.
 *
 *   release <out>                    download the release asset whose published
 *                                    receipt names the selected source, check the
 *                                    asset digest GitHub records, extract it
 *   receipt <source> <binary> <out>  write a v1 native receipt for a binary this
 *                                    workflow just built from the selected commit
 *   verify <dir>                     the binary hashes to its receipt, the receipt
 *                                    names the selected source, `--version`
 *                                    answers the selected version
 *
 * `<out>`/`<dir>` hold `formal-ai` and `formal-ai-receipt.json` — the layout the
 * draft job downloads and mounts. Any failure is a typed annotation (deferred
 * or mismatch) and exit 1; nothing here falls back to another binary.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { ATTEMPT_OUTCOMES, ATTEMPT_OUTCOME_ANNOTATION_TITLES, AttemptIdentityError, BINARY_FILE, BUILD_TARGET, buildNativeReceipt, normalizeSha256, parseAttemptIdentity, RECEIPT_FILE, RELEASE_CLI_ASSET, RELEASE_CLI_BINARY_PATH, releaseReceiptAsset, verifyAttemptBinary } from './formal-ai-draft-identity.lib.mjs';
import { formatWorkflowAnnotation } from './formal-ai-draft.lib.mjs';
import { gh, ghJson } from './github-actions.lib.mjs';

const execFileAsync = promisify(execFile);
const env = process.env;

export const sha256OfFile = path =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });

const run = async (file, args, options = {}) => (await execFileAsync(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })).stdout.trim();

const fail = error => {
  const outcome = error instanceof AttemptIdentityError ? error.outcome : ATTEMPT_OUTCOMES.deferred;
  console.log(formatWorkflowAnnotation('error', ATTEMPT_OUTCOME_ANNOTATION_TITLES[outcome], error.message));
  process.exit(1);
};

const loadIdentity = () => parseAttemptIdentity(env.FORMAL_AI_DRAFT_ATTEMPT_IDENTITY || 'null');

/** `release <out>`: the published build of the selected source. */
const release = async out => {
  const identity = loadIdentity();
  const { repository, release: selected } = identity.formalAi;
  if (!selected?.tag) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.mismatch, `attempt ${identity.id} did not select a release`);
  const work = mkdtempSync(join(tmpdir(), 'formal-ai-release-'));
  const receiptAsset = releaseReceiptAsset(selected.version);
  try {
    await gh(['release', 'download', selected.tag, '--repo', repository, '--pattern', RELEASE_CLI_ASSET, '--pattern', receiptAsset, '--dir', work]);
  } catch (error) {
    throw new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, `could not download ${RELEASE_CLI_ASSET} and ${receiptAsset} from ${repository} ${selected.tag}: ${error.message}`);
  }
  // GitHub records each asset's digest at upload; the download must be those bytes.
  const assets = (await ghJson(['api', `repos/${repository}/releases/tags/${selected.tag}`])).assets || [];
  for (const name of [RELEASE_CLI_ASSET, receiptAsset]) {
    const recorded = normalizeSha256(assets.find(asset => asset.name === name)?.digest);
    const actual = await sha256OfFile(join(work, name));
    if (recorded && recorded !== actual) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.mismatch, `${name} from ${selected.tag} hashes to ${actual}, but the release records ${recorded}`);
  }
  await run('tar', ['-xzf', join(work, RELEASE_CLI_ASSET), '-C', work, RELEASE_CLI_BINARY_PATH]);
  mkdirSync(out, { recursive: true });
  copyFileSync(join(work, RELEASE_CLI_BINARY_PATH), join(out, BINARY_FILE));
  copyFileSync(join(work, receiptAsset), join(out, RECEIPT_FILE));
  console.log(`Downloaded ${repository} ${selected.tag} (${RELEASE_CLI_ASSET}) for attempt ${identity.id}`);
};

/** `receipt <source> <binary> <out>`: record what this workflow built. */
const receipt = async (sourceDir, binaryPath, out) => {
  const identity = loadIdentity();
  const head = (await run('git', ['-C', sourceDir, 'rev-parse', 'HEAD'])).toLowerCase();
  // The checkout is the input; refuse to describe a build of anything else.
  if (head !== identity.formalAi.sourceSha) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.mismatch, `the Formal AI checkout is ${head}, but attempt ${identity.id} selected ${identity.formalAi.sourceSha}`);
  const compiler = await run('rustc', ['-vV']);
  const field = name => new RegExp(`^${name}: (.+)$`, 'm').exec(compiler)?.[1]?.trim() || null;
  mkdirSync(out, { recursive: true });
  copyFileSync(binaryPath, join(out, BINARY_FILE));
  const binary = join(out, BINARY_FILE);
  const record = buildNativeReceipt({
    sourceSha: head,
    sourceTree: await run('git', ['-C', sourceDir, 'rev-parse', 'HEAD^{tree}']),
    cargoLockSha256: await sha256OfFile(join(sourceDir, 'rust', 'Cargo.lock')),
    target: BUILD_TARGET,
    compiler,
    compilerRelease: field('release'),
    compilerCommit: field('commit-hash'),
    producerRun: env.GITHUB_RUN_ID,
    producerJob: env.GITHUB_JOB,
    producerAttempt: env.GITHUB_RUN_ATTEMPT,
    executableBytes: statSync(binary).size,
    executableSha256: await sha256OfFile(binary),
    version: identity.formalAi.version,
  });
  writeFileSync(join(out, RECEIPT_FILE), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Recorded the receipt for ${identity.formalAi.repository}@${head}: ${record.executable.sha256}`);
};

/** `verify <dir>`: the gate every binary passes, however it was obtained. */
const verify = async dir => {
  const identity = loadIdentity();
  const binary = join(dir, BINARY_FILE);
  const receiptPath = join(dir, RECEIPT_FILE);
  const present = existsSync(binary);
  if (present) chmodSync(binary, 0o755);
  const reported = present ? await run(binary, ['--version'], { timeout: 60_000 }).catch(error => `failed: ${error.message}`) : null;
  const verified = verifyAttemptBinary({
    identity,
    receipt: existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null,
    actualSha256: present ? await sha256OfFile(binary) : null,
    actualBytes: present ? statSync(binary).size : null,
    reportedVersion: reported,
  });
  console.log(`Verified the Formal AI binary for attempt ${identity.id}: ${JSON.stringify(verified)}`);
  if (env.GITHUB_OUTPUT) writeFileSync(env.GITHUB_OUTPUT, `binary_sha256=${verified?.sha256 || ''}\n`, { flag: 'a' });
};

const [command, ...args] = process.argv.slice(2);
const commands = { release: [release, 1], receipt: [receipt, 3], verify: [verify, 1] };
if (!commands[command] || args.length !== commands[command][1]) {
  console.error('usage: formal-ai-draft-binary.mjs release <out> | receipt <source> <binary> <out> | verify <dir>');
  process.exit(2);
}
try {
  await commands[command][0](...args);
} catch (error) {
  fail(error);
}
