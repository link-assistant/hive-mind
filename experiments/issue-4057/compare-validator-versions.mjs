// Issue #4057: compare the skill-catalog validator shipped in the failing
// release (hive-mind 2.39.14, commit 127c703f1) with the one in this checkout,
// using a synthetic checkout with two `.agents/skills` and one `.codex/skills`
// repository skill and no issue requirement.
//
// Usage (from the repository root):
//   node experiments/issue-4057/compare-validator-versions.mjs [old-ref]
//
// Expected output:
//   127c703f1 allowed= none | violations= 3
//   current   allowed= a-one,a-two,c-one | violations= 0
import process from 'node:process';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const oldRef = process.argv[2] || '127c703f1';
const repoRoot = process.cwd();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-4057-compare-'));
try {
  // The old module imports a sibling by relative path; rewrite it to the current file.
  const oldSource = execFileSync('git', ['show', `${oldRef}:src/codex-skill-catalog.lib.mjs`], { cwd: repoRoot, encoding: 'utf8' }).replaceAll("from './", `from '${pathToFileURL(path.join(repoRoot, 'src')).href}/`);
  const oldModule = path.join(root, 'old-codex-skill-catalog.mjs');
  await fs.writeFile(oldModule, oldSource);
  const old = await import(pathToFileURL(oldModule).href);
  const current = await import(pathToFileURL(path.join(repoRoot, 'src', 'codex-skill-catalog.lib.mjs')).href);

  const projectDir = path.join(root, 'checkout');
  const codexHome = path.join(root, 'codex-home');
  await fs.mkdir(path.join(codexHome, 'skills', '.system'), { recursive: true });
  const entries = [];
  for (const [directory, name] of [
    ['.agents/skills', 'a-one'],
    ['.agents/skills', 'a-two'],
    ['.codex/skills', 'c-one'],
  ]) {
    const file = path.join(projectDir, directory, name, 'SKILL.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `---\nname: ${name}\ndescription: synthetic\n---\n`);
    entries.push([name, file]);
  }
  const text = `<skills_instructions>\n### Available skills\n${entries.map(([name, file]) => `- ${name}: synthetic (file: ${file})`).join('\n')}\n</skills_instructions>`;
  const prompt = JSON.stringify([{ type: 'message', content: [{ type: 'input_text', text }] }]);
  for (const [label, lib] of [
    [oldRef, old],
    ['current', current],
  ]) {
    const validation = await lib.validateModelVisibleSkillCatalog({ catalog: lib.parseModelVisibleSkillCatalog(prompt), codexHome, projectDir });
    console.log(label.padEnd(9), 'allowed=', validation.allowed.map(entry => entry.name).join(',') || 'none', '| violations=', validation.violations.length);
    for (const violation of validation.violations) console.log('   ', violation.replaceAll(root, '<tmp>'));
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
