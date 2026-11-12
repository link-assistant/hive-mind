#!/usr/bin/env node
/**
 * Publish the native Codex executables as per-platform variant versions of this
 * package (issue #4050).
 *
 * Both executables in one tarball made @link-assistant/hive-mind 249,485,829
 * bytes, which npm refused with "E413 413 Payload Too Large", so 2.40.0 and
 * 2.40.1 never reached the registry and no Docker image was built. Like
 * @openai/codex, each platform is now its own version of the same package name:
 *
 *   @link-assistant/hive-mind@<version>-native-codex-linux-x64   (os linux, cpu x64)
 *   @link-assistant/hive-mind@<version>-native-codex-linux-arm64 (os linux, cpu arm64)
 *
 * published under a non-`latest` dist-tag, and the main package lists them as
 * optional dependency aliases, so npm and Bun install only the matching CPU's
 * variant. Reusing the name keeps OIDC trusted publishing working: a new
 * package name could not be bootstrapped by the release workflow.
 *
 * Commands (all paths absolute or relative to the working directory):
 *   pack <out-dir> [--runtime <dir>] [--platform <p>] [--no-verify]
 *                                     stage, pack, size-check and byte-verify each variant
 *                                     (--no-verify skips the Python byte check; the image
 *                                     build admits the same bytes in install-native-codex.mjs)
 *   wire [<package-dir>]              add the optionalDependencies (publication only; never committed)
 *   publish [<out-dir>] [--runtime <dir>]  pack, publish each missing variant, then wire
 *
 * HIVE_MIND_PUBLISH_VERBOSE=true shows the raw `npm view` probe output.
 * See src/native-codex/PACKAGES.md.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { findOversizedTarballs, formatOversizedReport, NPM_TARBALL_BUDGET_BYTES } from './check-npm-tarball-size.mjs';
import { describeNonRetryableFailure, isVersionConflict } from './publish-failure-classifier.mjs';
import { analyzePublishResult, runCommand } from './publish-to-npm.mjs';

const execute = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));

export const variantName = (name, platform) => `${name}-native-codex-${platform}`;
export const variantVersion = (version, platform) => `${version}-native-codex-${platform}`;
export const variantTag = platform => `native-codex-${platform}`;

export async function readPlatforms(recipeFile = path.join(repository, 'src/native-codex/recipe.json')) {
  return Object.keys(JSON.parse(await fs.readFile(recipeFile, 'utf8')).targets);
}

/** The variant's whole manifest: no scripts, bins or dependencies to run on install. */
export function variantManifest(main, platform) {
  const manifest = {
    name: main.name,
    version: variantVersion(main.version, platform),
    description: `Native Codex executable for ${main.name} on ${platform} (installed as ${variantName(main.name, platform)}).`,
    license: `SEE LICENSE IN runtime/${platform}/licenses/LICENSE`,
    os: [platform.split('-')[0]],
    cpu: [platform.split('-').slice(1).join('-')],
    files: ['runtime'],
  };
  for (const key of ['repository', 'homepage', 'bugs']) if (main[key]) manifest[key] = main[key];
  return manifest;
}

export function optionalDependenciesFor(main, platforms) {
  return Object.fromEntries(platforms.map(platform => [variantName(main.name, platform), `npm:${main.name}@${variantVersion(main.version, platform)}`]));
}

/** Copy one assembled platform runtime; only regular, unaliased files are admitted. */
async function copyRuntime(source, destination, top = true) {
  await fs.mkdir(destination, { recursive: true, mode: 0o755 });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyRuntime(from, to, false);
    else if (entry.isFile() && (await fs.lstat(from)).nlink === 1) {
      await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
      await fs.chmod(to, top && entry.name === 'codex' ? 0o755 : 0o644);
    } else throw new Error(`Refusing a non-regular native runtime entry: ${from}`);
  }
}

export async function packVariants({ out, runtime = path.join(repository, 'src/native-codex/runtime'), main, platforms, verify = true, budget = NPM_TARBALL_BUDGET_BYTES, log = console.log } = {}) {
  main ??= JSON.parse(await fs.readFile(path.join(repository, 'package.json'), 'utf8'));
  const known = await readPlatforms();
  platforms ??= known;
  const unknown = platforms.filter(platform => !known.includes(platform));
  if (unknown.length || !platforms.length) throw new Error(`Unsupported native Codex platforms: ${JSON.stringify(unknown)}; the recipe builds ${known.join(', ')}.`);
  await fs.mkdir(out, { recursive: true });
  const packed = [];
  for (const platform of platforms) {
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), `hive-native-codex-${platform}-`));
    try {
      await copyRuntime(path.join(runtime, platform), path.join(stage, 'runtime', platform));
      await fs.writeFile(path.join(stage, 'package.json'), `${JSON.stringify(variantManifest(main, platform), null, 2)}\n`);
      const { stdout } = await execute('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', path.resolve(out)], { cwd: stage, maxBuffer: 1 << 22 });
      const [entry] = JSON.parse(stdout);
      packed.push({ platform, alias: variantName(main.name, platform), tag: variantTag(platform), name: entry.name, version: entry.version, size: entry.size, files: entry.files, archive: path.join(path.resolve(out), entry.filename), filename: entry.filename });
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  }
  const oversized = findOversizedTarballs(packed, budget);
  if (oversized.length) throw new Error(formatOversizedReport(oversized, budget));
  for (const variant of packed) {
    if (verify) await execute('python3', [path.join(repository, 'scripts/build-native-codex.py'), 'verify-variant', variant.archive, variant.platform, main.name, main.version], { maxBuffer: 1 << 20 });
    log(`Packed ${variant.name}@${variant.version}: ${variant.size} bytes (budget ${budget}), installed as ${variant.alias}.`);
  }
  await fs.writeFile(
    path.join(out, 'variants.json'),
    `${JSON.stringify(
      packed.map(({ files: _files, ...variant }) => variant),
      null,
      2
    )}\n`
  );
  return packed;
}

/** Adds the variant aliases to a package.json at publication; idempotent. */
export async function wirePackage(packageDir = repository, { platforms, log = console.log } = {}) {
  platforms ??= await readPlatforms();
  const file = path.join(packageDir, 'package.json');
  const main = JSON.parse(await fs.readFile(file, 'utf8'));
  main.optionalDependencies = { ...main.optionalDependencies, ...optionalDependenciesFor(main, platforms) };
  await fs.writeFile(file, `${JSON.stringify(main, null, 2)}\n`);
  log(`Pinned ${platforms.length} native Codex variant packages in ${path.relative(process.cwd(), file) || file}.`);
  return main.optionalDependencies;
}

/**
 * Publishes every variant that is not on the registry yet. A retry after a
 * partial publication skips what landed; npm's "cannot publish over" for the
 * same version is that same success.
 */
export async function publishVariants(variants, { runner = runCommand, env = process.env, logger = console } = {}) {
  for (const variant of variants) {
    const spec = `${variant.name}@${variant.version}`;
    const probe = await runner('npm', ['view', spec, 'version'], { quiet: env.HIVE_MIND_PUBLISH_VERBOSE !== 'true' });
    if (probe.code === 0 && probe.stdout.trim() === variant.version) {
      logger.log(`${spec} is already published; skipping.`);
      continue;
    }
    logger.log(`Publishing ${spec} (${variant.size} bytes) under dist-tag ${variant.tag}...`);
    const analysis = analyzePublishResult(await runner('npm', ['publish', variant.archive, '--tag', variant.tag, '--access', 'public']));
    if (analysis.ok || isVersionConflict(analysis.output, variant.version)) continue;
    const { title, guidance } = analysis.nonRetryable ? describeNonRetryableFailure(analysis.output, spec) : { title: 'npm publish failed for a native Codex variant', guidance: '' };
    logger.error(`::error title=${title}::${spec} was not published (${analysis.reason}).`);
    if (guidance) logger.error(guidance);
    // `npm run changeset:publish` prints this, and publish-to-npm.mjs classifies it.
    throw new Error(`npm error native Codex variant ${spec} failed to publish: ${analysis.reason}`);
  }
}

const option = (args, name, resolve = path.resolve) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : resolve(args[index + 1]);
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, target, ...rest] = process.argv.slice(2);
  try {
    if (command === 'pack' && target) {
      const platform = option(rest, '--platform', value => value);
      await packVariants({ out: path.resolve(target), runtime: option(rest, '--runtime'), platforms: platform ? [platform] : undefined, verify: !rest.includes('--no-verify') });
    } else if (command === 'wire') await wirePackage(target ? path.resolve(target) : repository);
    else if (command === 'publish') {
      const out = target && !target.startsWith('--') ? path.resolve(target) : await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-native-codex-packages-'));
      await publishVariants(await packVariants({ out, runtime: option(target?.startsWith('--') ? [target, ...rest] : rest, '--runtime') }));
      await wirePackage(repository);
    } else {
      console.error('Usage: native-codex-packages.mjs pack <out-dir> [--runtime <dir>] [--platform <p>] [--no-verify] | wire [<package-dir>] | publish [<out-dir>] [--runtime <dir>]');
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.stderr ? `${error.message}\n${error.stderr}` : error.message);
    process.exitCode = 1;
  }
}
