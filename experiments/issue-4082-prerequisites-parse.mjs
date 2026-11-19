/* global console */
import { findMergePrerequisiteDeclarations } from '../src/merge-prerequisites.lib.mjs';
const ctx = { owner: 'o', repo: 'r', selfNumbers: [10, 9] };
const cases = ['Merge the companion PR in the other repository first.', 'Depends on o2/r2#5', 'This depends on the flag value.', 'Fixes #9', 'This PR does not need to be merged first.', '> Depends on #12', '```\nDepends on #12\n```', 'Please merge https://github.com/x/y/pull/3 first', 'I merged the default branch first', 'Blocked by #11', 'Do not merge before #7 lands', 'Requires #10'];
for (const c of cases) console.log(JSON.stringify(c), '=>', JSON.stringify(findMergePrerequisiteDeclarations(c, ctx)));
