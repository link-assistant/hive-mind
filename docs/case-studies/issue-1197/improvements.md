# Recommended Improvements for Test Timeout Management

## Overview

This document provides actionable recommendations for setting reasonable timeouts in tests, CI/CD workflows, and E2E test suites to enable faster iteration during development.

## 1. GitHub Actions Workflow Timeouts

### Job-Level Timeout

Always set a `timeout-minutes` at the job level to prevent runaway jobs:

```yaml
jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    timeout-minutes: 30 # Reasonable for most test suites
    steps:
      # ...
```

### Step-Level Timeout

For specific long-running steps, set individual timeouts:

```yaml
steps:
  - name: Run E2E tests
    timeout-minutes: 15
    run: npm run test:e2e
```

### Recommended Values

| Job Type          | Recommended Timeout |
| ----------------- | ------------------- |
| Lint/Format Check | 5-10 minutes        |
| Unit Tests        | 10-15 minutes       |
| Integration Tests | 15-20 minutes       |
| E2E Tests         | 15-30 minutes       |
| Full CI Pipeline  | 30-60 minutes       |

## 2. Test Runner Configuration

### Bun Test

```bash
# Set per-test timeout via CLI
bun test --timeout 30000  # 30 seconds per test

# Or in bunfig.toml
[test]
timeout = 30000
```

### Jest

```javascript
// jest.config.js
module.exports = {
  testTimeout: 30000, // 30 seconds per test
};

// Or per-test
it('my test', async () => {
  // ...
}, 30000);
```

### Vitest

```javascript
// vitest.config.js
export default {
  test: {
    testTimeout: 30000,
  },
};
```

## 3. Playwright E2E Test Timeouts

### Configuration File

```javascript
// playwright.config.js
export default {
  timeout: 30000, // 30 seconds per test
  expect: {
    timeout: 5000, // 5 seconds for assertions
  },
  use: {
    actionTimeout: 10000, // 10 seconds for actions
    navigationTimeout: 15000, // 15 seconds for navigation
  },
};
```

### Environment-Specific Timeouts

```javascript
// playwright.config.js
const isCI = !!process.env.CI;

export default {
  timeout: isCI ? 60000 : 30000,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  forbidOnly: isCI,
};
```

### Per-Test Timeout

```javascript
test('should complete quickly', async ({ page }) => {
  test.setTimeout(10000); // Override for this test
  // ...
});
```

## 4. Fail-Fast Strategies

### Critical Setup Test

Run a health check before the full test suite:

```javascript
describe('E2E Tests', () => {
  test.beforeAll(async () => {
    // Quick health check - fail fast if server is down
    const response = await fetch(BASE_URL, { timeout: 5000 });
    if (!response.ok) {
      throw new Error(`Server health check failed: ${response.status}`);
    }
  });

  // ... other tests
});
```

### GitHub Actions Fail-Fast Matrix

```yaml
jobs:
  test:
    strategy:
      fail-fast: true # Stop all matrix jobs if one fails
      matrix:
        test-type: [unit, integration, e2e]
```

## 5. Test Suite Organization

### Separate Fast and Slow Tests

```yaml
jobs:
  unit-tests:
    timeout-minutes: 10
    steps:
      - run: npm run test:unit

  e2e-tests:
    needs: unit-tests # Only run E2E if unit tests pass
    timeout-minutes: 30
    steps:
      - run: npm run test:e2e
```

### Conditional E2E Tests

```yaml
- name: Run E2E tests
  if: github.event_name == 'push' || github.event.pull_request.draft == false
  run: npm run test:e2e
```

## 6. Debug Timeout Issues

### Add Verbose Logging

```javascript
test('should render app', async ({ page }) => {
  await page.goto(BASE_URL);

  try {
    await page.waitForSelector('.app', { timeout: 10000 });
  } catch (error) {
    // Log debug info before failing
    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());
    const content = await page.content();
    console.log('Page HTML (first 500 chars):', content.slice(0, 500));
    throw error;
  }
});
```

### Take Screenshot on Failure

```javascript
// playwright.config.js
export default {
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
};
```

## 7. Monitoring and Alerts

### Track Test Duration Over Time

```yaml
- name: Run tests with timing
  run: |
    start_time=$(date +%s)
    npm test
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    echo "Test duration: ${duration}s"
    if [ $duration -gt 300 ]; then
      echo "::warning::Tests took longer than 5 minutes"
    fi
```

## 8. Checklist for New Projects

- [ ] Set job-level `timeout-minutes` in CI workflow
- [ ] Configure test framework default timeout
- [ ] Set Playwright/E2E framework timeouts
- [ ] Add health check before E2E tests
- [ ] Enable fail-fast for test matrices
- [ ] Configure screenshot/trace on failure
- [ ] Separate unit and E2E test jobs
- [ ] Document expected test duration in README

## References

- [Playwright CI Setup](https://playwright.dev/docs/ci-intro)
- [GitHub Actions Timeouts](https://graphite.com/guides/github-actions-timeouts)
- [Bun Test Runner](https://bun.com/docs/test)
- [Jest Configuration](https://jestjs.io/docs/configuration#testtimeout-number)
- [Vitest Configuration](https://vitest.dev/config/testtimeout)
