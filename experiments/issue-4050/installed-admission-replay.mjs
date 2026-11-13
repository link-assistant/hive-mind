#!/usr/bin/env node
// Issue #4050: replay the admission half of the "Exercise installed npm runtime" job
// without npm or running codex. Extract the main tarball and one variant tarball as
//   <root>/node_modules/@link-assistant/hive-mind
//   <root>/node_modules/@link-assistant/hive-mind-native-codex-linux-<arch>
// then: node installed-admission-replay.mjs <root>/node_modules/@link-assistant/hive-mind <new-output-dir>
// The runtime library uses only Node built-ins, so no dependency install is needed.
import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';
import console from 'node:console';
import { pathToFileURL } from 'node:url';

const installed = await fs.realpath(process.argv[2]);
const output = path.resolve(process.argv[3]);
await fs.mkdir(output, { mode: 0o700 });
const { installNativeCodexRuntime, verifyNativeCodexRuntime } = await import(pathToFileURL(path.join(installed, 'src/native-codex-runtime.lib.mjs')));
const ready = await installNativeCodexRuntime({ destination: path.join(output, 'runtime') });
const again = await verifyNativeCodexRuntime(path.join(output, 'runtime'));
console.log(JSON.stringify({ version: ready.version, sameEntrypoint: again.entrypoint === ready.entrypoint }));
