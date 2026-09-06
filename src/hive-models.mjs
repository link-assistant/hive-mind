#!/usr/bin/env node

/**
 * `hive-models` — list every model Hive Mind can drive, merging the models
 * bundled with this installation with the ones the providers are serving right
 * now (issue #2202, R5).
 *
 * Live sources are read only through endpoints that cannot bill a token, and
 * the merged answer is cached for an hour, so running this repeatedly is free.
 *
 * See issue #2202.
 */

import { runHiveModels } from './hive-models.lib.mjs';
import { setupStdioLogInterceptor } from './lib.mjs';

setupStdioLogInterceptor();

const exitCode = await runHiveModels(process.argv.slice(2));
process.exit(exitCode);
