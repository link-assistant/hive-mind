# Technical Summary: Test Timeout Analysis

## Environment Details

- **CI Platform**: GitHub Actions (ubuntu-latest)
- **Test Runner**: Bun test (v1.3.8)
- **E2E Framework**: browser-commander with Playwright (v1.58.0)
- **Application Type**: TSP (Traveling Salesman Problem) Solver - Web Application

## Timeout Hierarchy Analysis

### 1. GitHub Actions Workflow Level

```yaml
# Current state - NO timeout specified
test:
  name: Test (Bun)
  runs-on: ubuntu-latest
  # Missing: timeout-minutes: 10
```

**Default**: 360 minutes (6 hours)
**Recommended**: 10-30 minutes for test jobs

### 2. Test Framework Level (Bun)

```bash
# Current command
bun test tests/e2e

# No --timeout flag specified
# Default: 5000ms per test
```

**Note**: The individual test timeout specified in the test file (60000ms) overrides the Bun default.

### 3. Individual Test Level

```javascript
it('should load the page and display the title', async () => {
  // test code
}, 60000); // 60 second timeout per test
```

### 4. Playwright Selector Timeout

```javascript
await page.waitForSelector('.controls', { timeout: 20000 }); // 20 seconds
```

## Observed Failure Pattern

```
Test                                          | Duration | Status
----------------------------------------------|----------|--------
Initial Page Load > should load the page...   | 34.2s    | PASS
Initial Page Load > should display viz...     | 51.8s    | FAIL (TimeoutError)
Initial Page Load > should display controls   | 51.8s    | FAIL (TimeoutError)
Controls Interaction > grid size input        | 51.8s    | FAIL (TimeoutError)
Controls Interaction > speed slider           | 51.8s    | FAIL (TimeoutError)
...                                           | ~52s each| FAIL
```

### Why 51.8 Seconds?

The test duration of ~52 seconds (not 20 seconds as the `waitForSelector` timeout suggests) is explained by:

1. Browser launch time: ~30 seconds
2. `commander.goto()` navigation time
3. 20-second `waitForSelector` timeout
4. Cleanup time (`commander.destroy()`, `browser.close()`)

Each test creates a fresh browser instance, adding significant overhead.

## Error Message Analysis

```
TimeoutError: forSelector: Timeout 20000ms exceeded.
Call log:
  - waiting for locator('.app') to be visible

at /home/runner/work/tsp/tsp/tests/e2e/app.test.js:143:20
```

This indicates the application is not rendering the expected DOM structure. The `.app` and `.controls` CSS classes are never added to the DOM.

## Potential Root Causes for App Not Rendering

1. **Bundle not built correctly**: The `dist/main.js` might not contain the expected React components
2. **React rendering error**: Silent JavaScript error preventing component mounting
3. **CSS class mismatch**: Components exist but with different class names
4. **Server serving wrong content**: Static file server misconfiguration

## Time Multiplication Problem

With 10 E2E tests, each taking ~52 seconds when failing:
- **Total time when all fail**: ~520 seconds (~8.7 minutes)
- **If tests passed**: Would be much faster (most time is browser launch + timeout)

When the first 2-3 tests fail with the same pattern, subsequent tests will also fail. This creates unnecessary CI time consumption.

## Recommendations for This Specific Codebase

### 1. Add Test Suite Bailout

```javascript
// In test setup
let skipRemainingTests = false;

beforeEach(() => {
  if (skipRemainingTests) {
    throw new Error('Skipping due to previous critical failure');
  }
});

// After critical setup failure
it('should load the page', async () => {
  try {
    await page.waitForSelector('.app', { timeout: 10000 });
  } catch (e) {
    skipRemainingTests = true;
    throw e;
  }
});
```

### 2. Reduce Browser Overhead

```javascript
// Instead of creating new browser per test
let browser, page, commander;

beforeAll(async () => {
  const result = await launchBrowser({ engine: 'playwright', headless: true });
  browser = result.browser;
  page = result.page;
  commander = makeBrowserCommander({ page, verbose: false });
});

afterAll(async () => {
  await commander.destroy();
  await browser.close();
});

beforeEach(async () => {
  await commander.goto({ url: BASE_URL });
});
```

### 3. Add Health Check Before Tests

```javascript
beforeAll(async () => {
  // Quick health check
  const response = await fetch(BASE_URL);
  if (!response.ok) {
    throw new Error(`Server not healthy: ${response.status}`);
  }

  const html = await response.text();
  if (!html.includes('dist/main.js')) {
    throw new Error('Bundle not found in HTML');
  }
});
```

### 4. Add Workflow Timeouts

```yaml
test:
  name: Test (Bun)
  runs-on: ubuntu-latest
  timeout-minutes: 15
  steps:
    - name: Run E2E tests
      timeout-minutes: 10
      run: bun test tests/e2e --timeout 30000
```

## Debug Information for CI

Adding debug output helps diagnose issues:

```javascript
it('should load the page', async () => {
  const { browser, page, commander } = await createBrowser();
  try {
    await commander.goto({ url: BASE_URL });

    // Debug: Log page content if element not found
    const hasApp = await page.$('.app');
    if (!hasApp) {
      const html = await page.content();
      console.log('Page HTML:', html.substring(0, 1000));
      throw new Error('.app element not found');
    }
  } finally {
    await commander.destroy();
    await browser.close();
  }
});
```
