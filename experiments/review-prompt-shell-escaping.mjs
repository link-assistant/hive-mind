// Verify the literal review prompt survives command-stream interpolation.
import assert from 'node:assert/strict';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const { $ } = await use('command-stream');
const prompt = '`printf expanded` $(printf expanded) $REVIEW_LITERAL "quoted" \\';
for (const [name, escape] of [
  ['legacy', value => value.replaceAll('"', '\\"')],
  ['review', value => value],
]) {
  const result = await $({ mirror: false, env: { REVIEW_LITERAL: 'expanded' } })`printf '%s' "${escape(prompt)}"`;
  const output = result.stdout.toString();
  console.log(JSON.stringify({ name, literal: output === prompt, output }));
  if (name === 'review') assert.equal(output, prompt);
}
