#!/usr/bin/env node
// Issue #2198: reproduce the package manager that @changesets/format will use.
// `changeset version` (3.x) formats the files it rewrites by shelling out to
// `<agent> exec <formatter>`, where <agent> comes from package-manager-detector.
import { detect, resolveCommand } from 'package-manager-detector';

const cwd = process.argv[2] ?? process.cwd();
const detected = await detect({ cwd });
console.log('cwd     :', cwd);
console.log('detected:', JSON.stringify(detected));
const cmd = resolveCommand(detected?.agent ?? 'npm', 'execute-local', ['prettier', '--write', 'CHANGELOG.md']);
console.log('command :', cmd ? `${cmd.command} ${cmd.args.join(' ')}` : '(none)');
