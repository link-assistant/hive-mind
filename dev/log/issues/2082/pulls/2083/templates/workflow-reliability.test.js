import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';

function readWorkflow(filePath) {
  return readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n');
}

function getJobBlock(workflow, jobName) {
  const lines = workflow.split('\n');
  const jobHeader = `  ${jobName}:`;
  const start = lines.findIndex(line => line === jobHeader);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex((line, index) => index > start && /^[ ]{2}[a-zA-Z0-9_-]+:\s*$/.test(line));

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function getMultilineIfExpression(jobBlock) {
  const lines = jobBlock.split('\n');
  const start = lines.findIndex(line => line === '    if: |');

  if (start === -1) {
    return '';
  }

  const expressionLines = [];

  for (const line of lines.slice(start + 1)) {
    if (/^[ ]{4}\S/.test(line)) {
      break;
    }

    expressionLines.push(line.slice(6));
  }

  return expressionLines.join('\n').trim();
}

function evaluateWorkflowIf(expression, context) {
  const javaScriptExpression = expression
    .replaceAll('!cancelled()', '!context.cancelled')
    .replaceAll('github.event_name', 'context.github.event_name')
    .replace(/needs\.([a-zA-Z0-9_-]+)\.outputs\.([a-zA-Z0-9_-]+)/g, 'context.needs["$1"].outputs["$2"]')
    .replace(/needs\.([a-zA-Z0-9_-]+)\.result/g, 'context.needs["$1"].result');

  return Function('context', `"use strict"; return (${javaScriptExpression});`)(context);
}

function expectOrdered(text, markers) {
  let lastIndex = -1;

  for (const marker of markers) {
    const index = text.indexOf(marker);
    expect(index).toBeGreaterThan(lastIndex);
    lastIndex = index;
  }
}

function expectMainWriterConcurrency(jobBlock) {
  expect(jobBlock).toContain('    concurrency:\n      group: main-writer-${{ github.repository }}-main\n      cancel-in-progress: false');
}

function createTestJobContext({ eventName = 'pull_request', outputs = {}, result = 'skipped' } = {}) {
  return {
    cancelled: false,
    github: {
      event_name: eventName,
    },
    needs: {
      'detect-changes': {
        outputs: {
          'any-code-changed': 'false',
          'mjs-changed': 'false',
          'js-changed': 'false',
          'package-changed': 'false',
          'workflow-changed': 'false',
          ...outputs,
        },
      },
      'changeset-check': { result },
      'test-compilation': { result },
      lint: { result },
      'check-file-line-limits': { result },
    },
  };
}

describe('workflow reliability policy', () => {
  it('cancels superseded non-main runs without cancelling main runs', () => {
    const workflowPaths = ['.github/workflows/example-app.yml', '.github/workflows/release.yml', '.github/workflows/links.yml'];

    for (const workflowPath of workflowPaths) {
      const workflow = readWorkflow(workflowPath);

      expect(workflow).toContain('group: ${{ github.workflow }}-${{ github.ref }}');
      expect(workflow).toContain("cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}");
      expect(workflow).not.toContain("cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}");
    }
  });

  it('sets Git default branch config before checkout initializes repositories', () => {
    const releaseWorkflow = readWorkflow('.github/workflows/release.yml');
    const gitDefaultBranchEnv = ['env:', "  GIT_CONFIG_COUNT: '1'", '  GIT_CONFIG_KEY_0: init.defaultBranch', '  GIT_CONFIG_VALUE_0: main'].join('\n');

    expect(releaseWorkflow).toContain(gitDefaultBranchEnv);
    expectOrdered(releaseWorkflow, ['workflow_dispatch:', gitDefaultBranchEnv, 'concurrency:', 'jobs:', '- uses: actions/checkout@v6']);
  });

  it('excludes Vite source HTML from raw lychee file scans', () => {
    const linksWorkflow = readWorkflow('.github/workflows/links.yml');
    const viteSourceHtmlPath = 'examples/universal-app/index.html';
    const viteSourceHtml = readWorkflow(viteSourceHtmlPath);

    expect(viteSourceHtml).toContain('href="/favicon.svg"');
    expect(viteSourceHtml).toContain('src="/src/main.js"');
    expect(linksWorkflow).toContain(`--exclude-path ${viteSourceHtmlPath}`);
    expectOrdered(linksWorkflow, ['--exclude-path docs/case-studies', `--exclude-path ${viteSourceHtmlPath}`, "'./**/*.md'", "'./**/*.html'"]);
  });

  it('uploads preview regeneration artifacts when screenshot rendering fails', () => {
    const exampleAppWorkflow = readWorkflow('.github/workflows/example-app.yml');
    const previewRegenJob = getJobBlock(exampleAppWorkflow, 'preview-regen');

    expect(previewRegenJob).toContain('name: Upload screenshot failure artifacts');
    expect(previewRegenJob).toContain('if: failure()');
    expect(previewRegenJob).toContain('uses: actions/upload-artifact@v7');
    expect(previewRegenJob).toContain('name: preview-regen-failure-${{ github.run_id }}');
    expect(previewRegenJob).toContain('docs/screenshots/');
    expect(previewRegenJob).toContain('web/test-results/');
    expect(previewRegenJob).toContain('web/playwright-report/');
    expect(previewRegenJob).toContain('retention-days: 7');
    expect(previewRegenJob).toContain('if-no-files-found: ignore');
  });

  it('uses the official Playwright image for preview regeneration with browser downloads disabled', () => {
    const exampleAppWorkflow = readWorkflow('.github/workflows/example-app.yml');
    const previewRegenJob = getJobBlock(exampleAppWorkflow, 'preview-regen');
    const imageVersion = previewRegenJob.match(/image:\s*mcr\.microsoft\.com\/playwright:v([0-9.]+)-noble/)?.[1];
    const packageVersion = previewRegenJob.match(/playwright@([0-9.]+)/)?.[1];

    expect(previewRegenJob).toContain('container:');
    expect(imageVersion).toBe('1.59.1');
    expect(packageVersion).toBe(imageVersion);
    expect(previewRegenJob).toContain("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'");
    expect(previewRegenJob).not.toContain('npx playwright install');
    expect(previewRegenJob).not.toContain('~/.cache/ms-playwright');
  });

  it('serializes main writers and retries generated pushes after rebasing', () => {
    const exampleAppWorkflow = readWorkflow('.github/workflows/example-app.yml');
    const releaseWorkflow = readWorkflow('.github/workflows/release.yml');
    const pushHelper = readWorkflow('scripts/push-main-with-rebase-retry.sh');
    const versionAndCommit = readWorkflow('scripts/version-and-commit.mjs');
    const previewRegenJob = getJobBlock(exampleAppWorkflow, 'preview-regen');
    const releaseJob = getJobBlock(releaseWorkflow, 'release');
    const instantReleaseJob = getJobBlock(releaseWorkflow, 'instant-release');

    expectMainWriterConcurrency(previewRegenJob);
    expectMainWriterConcurrency(releaseJob);
    expectMainWriterConcurrency(instantReleaseJob);
    expect(previewRegenJob).toContain('bash scripts/push-main-with-rebase-retry.sh');
    expect(previewRegenJob).not.toContain('git push origin HEAD:main');
    expect(versionAndCommit).toContain('bash scripts/push-main-with-rebase-retry.sh');
    expect(versionAndCommit).not.toContain('git push origin main');
    expect(pushHelper).toContain('git push "$remote" "HEAD:$branch"');
    expect(pushHelper).toContain('git pull --rebase "$remote" "$branch"');
  });

  it('verifies desktop package output before uploading artifacts', () => {
    const exampleAppWorkflow = readWorkflow('.github/workflows/example-app.yml');
    const desktopPackageJob = getJobBlock(exampleAppWorkflow, 'desktop-package');
    const packageStepIndex = desktopPackageJob.indexOf('name: Package Electron app');
    const uploadStepIndex = desktopPackageJob.indexOf('name: Upload desktop package');

    expect(packageStepIndex).toBeGreaterThanOrEqual(0);
    expect(uploadStepIndex).toBeGreaterThan(packageStepIndex);
    expect(desktopPackageJob).toContain("node-version: '20.x'");
    expect(desktopPackageJob).not.toContain("node-version: '24.x'");
    expect(desktopPackageJob).toContain('shell: bash');
    expect(desktopPackageJob).toContain('npm run example:desktop:package');
    expect(desktopPackageJob).toContain('find examples/universal-app/out');
    expect(desktopPackageJob).toContain('Desktop package output was not created at examples/universal-app/out');
    expect(desktopPackageJob).toContain('if-no-files-found: error');
  });
});

describe('release workflow change gates', () => {
  it('skips the slow test matrix for pull requests with no code changes', () => {
    const workflow = readWorkflow('.github/workflows/release.yml');
    const testJob = getJobBlock(workflow, 'test');
    const testCondition = getMultilineIfExpression(testJob);
    const nonCodePullRequest = createTestJobContext();

    expect(evaluateWorkflowIf(testCondition, nonCodePullRequest)).toBe(false);
  });

  it('runs the slow test matrix for workflow changes after fast checks pass', () => {
    const workflow = readWorkflow('.github/workflows/release.yml');
    const testJob = getJobBlock(workflow, 'test');
    const testCondition = getMultilineIfExpression(testJob);
    const workflowPullRequest = createTestJobContext({
      outputs: {
        'any-code-changed': 'true',
        'workflow-changed': 'true',
      },
      result: 'success',
    });

    expect(evaluateWorkflowIf(testCondition, workflowPullRequest)).toBe(true);
  });
});

describe('npm publish token bootstrap', () => {
  // The first publish of a brand-new package cannot use OIDC trusted publishing
  // (npm returns E404 because a trusted publisher can only be configured for an
  // existing package). Every Publish-to-npm step must therefore expose an
  // optional NODE_AUTH_TOKEN fallback sourced from secrets.NPM_TOKEN.
  for (const jobName of ['release', 'instant-release']) {
    it(`passes secrets.NPM_TOKEN as NODE_AUTH_TOKEN on the ${jobName} publish step`, () => {
      const workflow = readWorkflow('.github/workflows/release.yml');
      const job = getJobBlock(workflow, jobName);

      expect(job).toContain('node scripts/publish-to-npm.mjs');
      expect(job).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');
    });
  }
});

describe('npm user config cleanup', () => {
  for (const jobName of ['release', 'instant-release']) {
    it(`removes deprecated always-auth before npm commands in the ${jobName} job`, () => {
      const workflow = readWorkflow('.github/workflows/release.yml');
      const job = getJobBlock(workflow, jobName);

      expectOrdered(job, ['uses: actions/setup-node@v6', '- name: Remove deprecated npm auth config', '- name: Install dependencies']);
      expect(job).toContain('run: node scripts/sanitize-npm-userconfig.mjs');
    });
  }
});

describe('install-from-package smoke test', () => {
  for (const jobName of ['release', 'instant-release']) {
    it(`smoke-tests the published npm package in the ${jobName} job`, () => {
      const workflow = readWorkflow('.github/workflows/release.yml');
      const job = getJobBlock(workflow, jobName);

      expectOrdered(job, ['- name: Publish to npm', '- name: Smoke-test published npm package', '- name: Create GitHub Release']);
      expect(job).toContain('node scripts/smoke-test-package.mjs --package-version "${{ steps.publish.outputs.published_version }}"');
    });
  }
});
