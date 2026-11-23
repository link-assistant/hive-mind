#!/usr/bin/env node
// Loads the pinned use-m bootstrap (src/use-m-bootstrap.lib.mjs) exactly as
// production does and imports one small package through it (issue #4025,
// use-m 8.16.4 -> 8.17.0). Needs network access.
import { USE_M_BOOTSTRAP_URL } from '../../src/use-m-bootstrap.lib.mjs';

const { use } = eval(await (await fetch(USE_M_BOOTSTRAP_URL)).text());
const semver = await use('semver@7.7.2');
console.log(JSON.stringify({ bootstrap: USE_M_BOOTSTRAP_URL, valid: semver.valid('1.2.3') }));
if (semver.valid('1.2.3') !== '1.2.3') process.exitCode = 1;
