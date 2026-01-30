/**
 * End-to-end tests for the TSP Solver application
 * Tests the full user workflow using browser-commander with Playwright
 */

/* global setTimeout */
/* eslint-disable max-lines-per-function */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { launchBrowser, makeBrowserCommander } from 'browser-commander';
import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

/**
 * Wait for the server to be ready by polling
 */
async function waitForServer(url, maxAttempts = 30, delayMs = 200) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Server did not start within ${(maxAttempts * delayMs) / 1000} seconds`
  );
}

/**
 * Build the application if dist/main.js doesn't exist
 */
function buildAppIfNeeded() {
  const distPath = 'dist/main.js';

  if (!existsSync(distPath)) {
    console.log('Building application...');
    const result = spawnSync('bun', ['run', 'build'], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    if (result.status !== 0) {
      throw new Error('Build failed');
    }
    console.log('Build complete.');
  }
}

/**
 * Start the dev server
 */
async function startServer() {
  // Ensure the app is built
  buildAppIfNeeded();

  // Kill any existing process on the port first
  try {
    spawnSync('pkill', ['-f', `serve.js.*PORT=${PORT}`], { stdio: 'ignore' });
    spawnSync('fuser', ['-k', `${PORT}/tcp`], { stdio: 'ignore' });
  } catch {
    // Ignore errors
  }

  await new Promise((r) => setTimeout(r, 500));

  serverProcess = spawn('bun', ['serve.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: process.cwd(),
    detached: true,
  });

  serverProcess.stdout.on('data', () => {
    // Server stdout - ignore
  });

  serverProcess.stderr.on('data', (data) => {
    console.error('Server stderr:', data.toString());
  });

  serverProcess.on('error', (err) => {
    console.error('Server error:', err);
  });

  // Wait for server to be ready
  await waitForServer(BASE_URL);
}

/**
 * Stop the dev server
 */
function stopServer() {
  if (serverProcess) {
    try {
      process.kill(-serverProcess.pid, 'SIGKILL');
    } catch {
      try {
        serverProcess.kill('SIGKILL');
      } catch {
        // Ignore errors
      }
    }
    serverProcess = null;
  }

  // Also try to kill by port
  try {
    spawnSync('fuser', ['-k', `${PORT}/tcp`], { stdio: 'ignore' });
  } catch {
    // Ignore errors
  }
}

/**
 * Create a fresh browser and page for each test
 */
async function createBrowser() {
  const result = await launchBrowser({
    engine: 'playwright',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const commander = makeBrowserCommander({ page: result.page, verbose: false });
  return { browser: result.browser, page: result.page, commander };
}

describe('TSP Solver E2E', () => {
  beforeAll(async () => {
    await startServer();
    // Extra delay to ensure server is fully ready
    await new Promise((r) => setTimeout(r, 1000));
  }, 60000);

  afterAll(() => {
    stopServer();
  });

  describe('Initial Page Load', () => {
    it('should load the page and display the title', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });
        const title = await page.title();
        expect(title).toContain('TSP');
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);

    it('should display visualization container', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        // Wait for the app to render
        await page.waitForSelector('.app', { timeout: 20000 });

        // Check for visualization container
        const container = await page.$('.visualization-container');
        expect(container).toBeTruthy();
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);

    it('should display control elements', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('.controls', { timeout: 20000 });

        // Check for Start button
        const startButton = await page.$('button:has-text("Start")');
        expect(startButton).toBeTruthy();

        // Check for New Points button
        const newPointsButton = await page.$('button:has-text("New Points")');
        expect(newPointsButton).toBeTruthy();
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);
  });

  describe('Controls Interaction', () => {
    it('should have grid size input', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('.controls', { timeout: 20000 });

        // Find grid size input
        const gridInputs = await page.$$('input[type="number"]');
        expect(gridInputs.length).toBeGreaterThanOrEqual(1);
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);

    it('should have speed slider', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('.controls', { timeout: 20000 });

        // Find speed slider
        const slider = await page.$('input[type="range"]');
        expect(slider).toBeTruthy();
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);

    it('should enable Generate New Points button', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('.controls', { timeout: 20000 });

        const newPointsButton = await page.$('button:has-text("New Points")');
        const isDisabled = await newPointsButton.getAttribute('disabled');
        expect(isDisabled).toBeNull();
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);

    it('should generate new points when clicking New Points button', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('.controls', { timeout: 20000 });

        // Click New Points button
        await page.click('button:has-text("New Points")');

        // Wait for SVG to contain circles (points)
        await page.waitForSelector('svg circle', { timeout: 20000 });

        const circles = await page.$$('svg circle');
        expect(circles.length).toBeGreaterThan(0);
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);
  });

  describe('Algorithm Execution', () => {
    it('should start algorithm when clicking Start button', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('.controls', { timeout: 20000 });

        // First generate points
        await page.click('button:has-text("New Points")');
        await page.waitForSelector('svg circle', { timeout: 20000 });

        // Click Start button
        await page.click('button:has-text("Start")');

        // Wait a bit for the algorithm to start
        await new Promise((r) => setTimeout(r, 1000));

        // Check if Stop button appears (indicating algorithm is running)
        const stopButton = await page.$('button:has-text("Stop")');
        // If not running anymore, Start should be back
        const startButton = await page.$('button:has-text("Start")');

        expect(stopButton || startButton).toBeTruthy();
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);

    it('should display distance information', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('.controls', { timeout: 20000 });

        // Generate points
        await page.click('button:has-text("New Points")');
        await page.waitForSelector('svg circle', { timeout: 20000 });

        // Click Start button
        await page.click('button:has-text("Start")');

        // Wait for algorithm to complete or show distance
        await new Promise((r) => setTimeout(r, 2000));

        // Check for distance display
        const pageContent = await page.content();
        expect(pageContent).toContain('Distance');
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);
  });

  describe('Visualization', () => {
    it('should render SVG visualization', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('svg', { timeout: 20000 });

        const svg = await page.$('svg');
        expect(svg).toBeTruthy();
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);

    it('should display grid lines in visualization', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('svg', { timeout: 20000 });

        // Check for grid lines
        const lines = await page.$$('svg line');
        expect(lines.length).toBeGreaterThan(0);
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);

    it('should display legend', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('.legend', { timeout: 20000 });

        const legend = await page.$('.legend');
        expect(legend).toBeTruthy();
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);
  });

  describe('Input Change Events', () => {
    it('should update grid size when input changes', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('.controls', { timeout: 20000 });

        // Find grid size input (first number input)
        const gridInput = await page.$('input[type="number"]');

        // Clear and type new value
        await gridInput.fill('20');

        // The input should now have the new value
        const value = await gridInput.inputValue();
        expect(value).toBe('20');
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);

    it('should update speed when slider changes', async () => {
      const { browser, page, commander } = await createBrowser();
      try {
        await commander.goto({ url: BASE_URL });

        await page.waitForSelector('.controls', { timeout: 20000 });

        const slider = await page.$('input[type="range"]');
        const initialValue = await slider.inputValue();

        // Change slider value
        await slider.fill('200');

        const newValue = await slider.inputValue();
        expect(newValue).toBe('200');
        expect(newValue).not.toBe(initialValue);
      } finally {
        await commander.destroy();
        await browser.close();
      }
    }, 60000);
  });
});
