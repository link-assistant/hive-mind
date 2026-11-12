// Issue #4050: does a publish-failure classifier treat npm's E413 as retryable?
// Usage: node experiments/issue-4050/template-e413-classification.mjs <classifier.mjs>
// The argument is a downloaded copy of a template's scripts/publish-failure-classifier.mjs.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const classifier = await import(pathToFileURL(path.resolve(process.argv[2] ?? 'scripts/publish-failure-classifier.mjs')).href);
const e413 = 'npm error code E413\nnpm error 413 Payload Too Large - PUT https://registry.npmjs.org/@link-assistant%2fhive-mind - Payload Too Large';
const fn = classifier.isNonRetryableFailure;
console.log(JSON.stringify({ exported: Object.keys(classifier), nonRetryable: typeof fn === 'function' ? fn(e413) : 'n/a' }));
