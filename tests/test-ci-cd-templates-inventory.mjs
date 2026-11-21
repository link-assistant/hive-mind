#!/usr/bin/env node
/**
 * @hive-mind-test-suite github-integration
 * Compare CI_CD_TEMPLATES with the live link-foundation pipeline templates.
 *
 * Issue #2573: the C/C++ template existed for days before `fix --ci-cd` knew
 * about it. This fails as soon as a new public template appears (or a listed
 * one is renamed, deleted or archived) so the mapping and
 * docs/CI-CD-BEST-PRACTICES*.md are updated together.
 */
import assert from 'node:assert/strict';
import { ghList } from '../scripts/github-actions.lib.mjs';
import { CI_CD_TEMPLATE_OWNER, CI_CD_TEMPLATE_REPO_SUFFIX, diffCiCdTemplates } from '../src/fix.ci-cd.lib.mjs';

const repositories = await ghList(`orgs/${CI_CD_TEMPLATE_OWNER}/repos?type=public&per_page=100`);
const templates = repositories.filter(repository => repository.name.endsWith(CI_CD_TEMPLATE_REPO_SUFFIX));
console.log(`${CI_CD_TEMPLATE_OWNER} has ${templates.length} *${CI_CD_TEMPLATE_REPO_SUFFIX} repositories: ${templates.map(repository => `${repository.name}${repository.archived ? ' (archived)' : ''}`).join(', ')}`);

const { unlisted, stale } = diffCiCdTemplates(repositories);
assert.deepEqual(unlisted, [], `Add these templates to CI_CD_TEMPLATES (src/fix.ci-cd.lib.mjs) and docs/CI-CD-BEST-PRACTICES*.md: ${unlisted.join(', ')}`);
assert.deepEqual(stale, [], `These CI_CD_TEMPLATES entries are no longer active public repositories: ${stale.join(', ')}`);
console.log('CI_CD_TEMPLATES matches the published pipeline templates.');
