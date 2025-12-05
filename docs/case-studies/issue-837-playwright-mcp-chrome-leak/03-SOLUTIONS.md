# Proposed Solutions and Mitigations

## Overview

This document provides detailed solutions for preventing and mitigating Chrome process leaks when using Playwright MCP with Claude Code tools.

## Solution Categories

| Category | Solutions | Implementation Time |
|----------|-----------|---------------------|
| Immediate Mitigations | Cron cleanup, Kill orphans | Minutes |
| Configuration Changes | Isolated mode, Docker flags | Hours |
| Code Improvements | Error handling, Signal handlers | Days |
| Architecture Changes | Process recycling, Monitoring | Weeks |

## Immediate Mitigations

### Solution 1: Periodic Process Cleanup Cron Job

**Priority**: HIGH
**Implementation Time**: 5 minutes

Add a cron job to periodically clean up orphaned Chrome processes:

```bash
# Edit crontab
crontab -e

# Add these lines:
# Clean up orphaned Chrome processes every 30 minutes
*/30 * * * * /usr/local/bin/cleanup-chrome.sh >> /var/log/chrome-cleanup.log 2>&1

# More aggressive cleanup every 6 hours
0 */6 * * * pkill -9 -f "chrome-headless" 2>/dev/null; pkill -9 -f "chromium" 2>/dev/null
```

**cleanup-chrome.sh script**:
```bash
#!/bin/bash
# /usr/local/bin/cleanup-chrome.sh

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')] Chrome Cleanup:"

# Count current Chrome processes
CHROME_COUNT=$(pgrep -c -f "chrome|chromium" 2>/dev/null || echo "0")
echo "$LOG_PREFIX Found $CHROME_COUNT Chrome processes"

# Only clean up if count exceeds threshold
MAX_PROCESSES=10
if [ "$CHROME_COUNT" -gt "$MAX_PROCESSES" ]; then
    echo "$LOG_PREFIX Threshold exceeded (max: $MAX_PROCESSES), initiating cleanup"

    # Graceful kill first
    pkill -f "chrome-headless" 2>/dev/null
    pkill -f "chromium" 2>/dev/null
    sleep 5

    # Force kill any remaining
    pkill -9 -f "chrome-headless" 2>/dev/null
    pkill -9 -f "chromium" 2>/dev/null

    # Report result
    NEW_COUNT=$(pgrep -c -f "chrome|chromium" 2>/dev/null || echo "0")
    KILLED=$((CHROME_COUNT - NEW_COUNT))
    echo "$LOG_PREFIX Cleanup complete. Killed $KILLED processes. Remaining: $NEW_COUNT"
else
    echo "$LOG_PREFIX Count within threshold, no cleanup needed"
fi
```

Make it executable:
```bash
chmod +x /usr/local/bin/cleanup-chrome.sh
```

### Solution 2: Manual Recovery Commands

**Priority**: HIGH
**Use Case**: Immediate recovery from resource exhaustion

```bash
# Step 1: Identify all Chrome processes
ps aux | grep -E "chrome|chromium" | grep -v grep

# Step 2: Get process count
pgrep -c -f "chrome|chromium"

# Step 3: Kill all Chrome processes gracefully
pkill -f "chrome-headless"
pkill -f "chromium"

# Step 4: Wait for graceful shutdown
sleep 10

# Step 5: Force kill remaining
pkill -9 -f "chrome-headless"
pkill -9 -f "chromium"

# Step 6: Verify cleanup
pgrep -c -f "chrome|chromium"
free -m
```

### Solution 3: Systemd Service with Limits

**Priority**: MEDIUM
**Use Case**: Controlled MCP server with automatic restarts

```ini
# /etc/systemd/system/playwright-mcp.service
[Unit]
Description=Playwright MCP Server
After=network.target

[Service]
Type=simple
User=hive
WorkingDirectory=/opt/playwright-mcp
ExecStart=/usr/bin/npx @playwright/mcp@latest --isolated --headless
Restart=always
RestartSec=10

# Memory limits
MemoryMax=2G
MemoryHigh=1.5G

# Process limits
TasksMax=50

# Auto-restart every 4 hours to prevent accumulation
RuntimeMaxSec=14400

# Cleanup on stop
ExecStop=/bin/bash -c 'pkill -9 -f "chrome-headless" || true'

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable playwright-mcp
sudo systemctl start playwright-mcp
```

## Configuration Changes

### Solution 4: Use Isolated Mode

**Priority**: HIGH
**Implementation Time**: 10 minutes

Switch from persistent (default) mode to isolated mode:

```bash
# Instead of:
npx @playwright/mcp@latest

# Use:
npx @playwright/mcp@latest --isolated
```

**Benefits**:
- Ephemeral browser contexts
- Automatic cleanup on session end
- No persistent profile accumulation
- Fresh state for each session

**Drawbacks**:
- No persistent authentication
- Cookies lost between sessions
- May need to re-authenticate each time

**Hybrid approach** - Use storage state for auth:
```bash
# Save auth state once
npx playwright codegen --save-storage=auth.json

# Use with isolated mode
npx @playwright/mcp@latest --isolated --storage-state=auth.json
```

### Solution 5: Docker with Proper Configuration

**Priority**: HIGH
**Implementation Time**: 30 minutes

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  playwright-mcp:
    image: mcr.microsoft.com/playwright:latest
    init: true  # Proper process reaping
    ipc: host   # Shared memory access
    cap_add:
      - SYS_ADMIN  # Required for sandbox
    shm_size: 2gb  # Adequate shared memory
    environment:
      - NODE_ENV=production
    command: npx @playwright/mcp@latest --isolated --headless
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 4G
        reservations:
          memory: 1G
    healthcheck:
      test: ["CMD", "pgrep", "-f", "playwright"]
      interval: 30s
      timeout: 10s
      retries: 3
```

**Dockerfile with proper setup**:
```dockerfile
FROM mcr.microsoft.com/playwright:latest

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m playwright

USER playwright
WORKDIR /home/playwright

# Copy application
COPY --chown=playwright:playwright . .

# Use dumb-init as entrypoint
ENTRYPOINT ["dumb-init", "--"]
CMD ["npx", "@playwright/mcp@latest", "--isolated", "--headless"]
```

### Solution 6: Kubernetes Configuration

**Priority**: MEDIUM
**Use Case**: Kubernetes deployments

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: playwright-mcp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: playwright-mcp
  template:
    metadata:
      labels:
        app: playwright-mcp
    spec:
      containers:
      - name: playwright-mcp
        image: your-registry/playwright-mcp:latest
        resources:
          limits:
            memory: "4Gi"
            cpu: "2"
          requests:
            memory: "1Gi"
            cpu: "500m"
        securityContext:
          capabilities:
            add:
              - SYS_ADMIN
        volumeMounts:
        - name: shm
          mountPath: /dev/shm
        livenessProbe:
          exec:
            command:
            - pgrep
            - -f
            - playwright
          initialDelaySeconds: 30
          periodSeconds: 30
        # Auto-restart every 4 hours
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "pkill -9 -f chrome || true"]
      volumes:
      - name: shm
        emptyDir:
          medium: Memory
          sizeLimit: 2Gi
      # Use init container pattern for zombie reaping
      shareProcessNamespace: true
```

## Code Improvements

### Solution 7: Proper Error Handling with Cleanup

**Priority**: HIGH
**Implementation Location**: MCP tool handlers

```javascript
// lib/browserManager.js
class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async launch(options = {}) {
    const playwright = require('playwright');
    this.browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      ...options
    });

    // Register for cleanup
    this._registerCleanupHandlers();

    return this.browser;
  }

  async createContext(options = {}) {
    if (!this.browser) {
      throw new Error('Browser not launched');
    }
    this.context = await this.browser.newContext(options);
    return this.context;
  }

  async createPage() {
    if (!this.context) {
      await this.createContext();
    }
    this.page = await this.context.newPage();
    return this.page;
  }

  async execute(fn) {
    try {
      const page = await this.createPage();
      const result = await fn(page);
      return result;
    } finally {
      await this.cleanup();
    }
  }

  async cleanup() {
    const errors = [];

    if (this.page) {
      try {
        await this.page.close();
      } catch (e) {
        errors.push(`Page close error: ${e.message}`);
      }
      this.page = null;
    }

    if (this.context) {
      try {
        await this.context.close();
      } catch (e) {
        errors.push(`Context close error: ${e.message}`);
      }
      this.context = null;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {
        errors.push(`Browser close error: ${e.message}`);
        // Force kill as last resort
        this._forceKill();
      }
      this.browser = null;
    }

    if (errors.length > 0) {
      console.error('Cleanup errors:', errors);
    }
  }

  _forceKill() {
    if (this.browser) {
      const proc = this.browser.process();
      if (proc) {
        try {
          proc.kill('SIGKILL');
        } catch (e) {
          console.error('Force kill failed:', e);
        }
      }
    }
  }

  _registerCleanupHandlers() {
    const cleanup = async () => {
      await this.cleanup();
      process.exit(0);
    };

    process.once('SIGTERM', cleanup);
    process.once('SIGINT', cleanup);
    process.once('exit', () => {
      // Synchronous force cleanup
      this._forceKill();
    });
  }
}

module.exports = BrowserManager;
```

**Usage**:
```javascript
const BrowserManager = require('./lib/browserManager');

async function scrapeWebsite(url) {
  const manager = new BrowserManager();

  return await manager.execute(async (page) => {
    await page.goto(url);
    const title = await page.title();
    return { url, title };
  });
  // Browser automatically cleaned up after execute()
}
```

### Solution 8: Browser Pool with Recycling

**Priority**: MEDIUM
**Use Case**: High-volume automation

```javascript
// lib/browserPool.js
class BrowserPool {
  constructor(options = {}) {
    this.maxBrowsers = options.maxBrowsers || 5;
    this.maxAgeMs = options.maxAgeMs || 30 * 60 * 1000; // 30 minutes
    this.maxUsesPerBrowser = options.maxUsesPerBrowser || 100;

    this.browsers = [];
    this.playwright = null;
  }

  async init() {
    this.playwright = require('playwright');
  }

  async acquire() {
    // Find a healthy browser
    const healthyBrowser = this.browsers.find(b =>
      b.useCount < this.maxUsesPerBrowser &&
      (Date.now() - b.createdAt) < this.maxAgeMs
    );

    if (healthyBrowser) {
      healthyBrowser.useCount++;
      return healthyBrowser.browser;
    }

    // Create new browser if under limit
    if (this.browsers.length < this.maxBrowsers) {
      return await this._createBrowser();
    }

    // Recycle oldest browser
    await this._recycleOldest();
    return await this._createBrowser();
  }

  async release(browser) {
    const entry = this.browsers.find(b => b.browser === browser);
    if (entry) {
      // Check if browser needs recycling
      if (entry.useCount >= this.maxUsesPerBrowser ||
          (Date.now() - entry.createdAt) >= this.maxAgeMs) {
        await this._closeBrowser(entry);
      }
    }
  }

  async _createBrowser() {
    const browser = await this.playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    const entry = {
      browser,
      createdAt: Date.now(),
      useCount: 1
    };

    this.browsers.push(entry);
    return browser;
  }

  async _closeBrowser(entry) {
    try {
      await entry.browser.close();
    } catch (e) {
      entry.browser.process()?.kill('SIGKILL');
    }
    this.browsers = this.browsers.filter(b => b !== entry);
  }

  async _recycleOldest() {
    if (this.browsers.length === 0) return;

    // Sort by age and recycle oldest
    this.browsers.sort((a, b) => a.createdAt - b.createdAt);
    await this._closeBrowser(this.browsers[0]);
  }

  async shutdown() {
    await Promise.all(
      this.browsers.map(entry => this._closeBrowser(entry))
    );
    this.browsers = [];
  }
}

module.exports = BrowserPool;
```

### Solution 9: Process Monitoring and Alerting

**Priority**: HIGH
**Implementation Location**: Server monitoring

**monitor-chrome.sh**:
```bash
#!/bin/bash
# /usr/local/bin/monitor-chrome.sh

# Configuration
MAX_CHROME_PROCESSES=10
MAX_MEMORY_PERCENT=80
ALERT_WEBHOOK="https://your-webhook-url"
LOG_FILE="/var/log/chrome-monitor.log"

# Get metrics
CHROME_COUNT=$(pgrep -c -f "chrome|chromium" 2>/dev/null || echo "0")
MEMORY_PERCENT=$(free | grep Mem | awk '{printf("%.0f", $3/$2 * 100.0)}')
LOAD_AVG=$(cat /proc/loadavg | awk '{print $1}')

# Log current state
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Chrome: $CHROME_COUNT, Memory: $MEMORY_PERCENT%, Load: $LOAD_AVG" >> "$LOG_FILE"

# Check thresholds
ALERT_NEEDED=false
ALERT_MESSAGE=""

if [ "$CHROME_COUNT" -gt "$MAX_CHROME_PROCESSES" ]; then
    ALERT_NEEDED=true
    ALERT_MESSAGE="Chrome process count: $CHROME_COUNT (threshold: $MAX_CHROME_PROCESSES)"
fi

if [ "$MEMORY_PERCENT" -gt "$MAX_MEMORY_PERCENT" ]; then
    ALERT_NEEDED=true
    ALERT_MESSAGE="$ALERT_MESSAGE Memory usage: $MEMORY_PERCENT% (threshold: $MAX_MEMORY_PERCENT%)"
fi

# Send alert if needed
if [ "$ALERT_NEEDED" = true ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ALERT: $ALERT_MESSAGE" >> "$LOG_FILE"

    # Send webhook (example for Slack)
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"🚨 Chrome Process Alert: $ALERT_MESSAGE\"}" \
        "$ALERT_WEBHOOK" 2>/dev/null

    # Auto-cleanup if critical
    if [ "$CHROME_COUNT" -gt $((MAX_CHROME_PROCESSES * 2)) ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Auto-cleanup triggered" >> "$LOG_FILE"
        pkill -9 -f "chrome-headless" 2>/dev/null
    fi
fi
```

**Add to crontab for continuous monitoring**:
```bash
# Run every 5 minutes
*/5 * * * * /usr/local/bin/monitor-chrome.sh
```

## Architecture Changes

### Solution 10: Supervisor Pattern with PM2

**Priority**: MEDIUM
**Implementation Time**: 1-2 hours

**ecosystem.config.js**:
```javascript
module.exports = {
  apps: [{
    name: 'playwright-mcp',
    script: 'npx',
    args: '@playwright/mcp@latest --isolated --headless',
    cwd: '/opt/playwright-mcp',

    // Auto-restart every 4 hours
    cron_restart: '0 */4 * * *',

    // Memory limit restart
    max_memory_restart: '2G',

    // Graceful restart
    kill_timeout: 10000,
    wait_ready: true,

    // Logging
    log_file: '/var/log/playwright-mcp/combined.log',
    error_file: '/var/log/playwright-mcp/error.log',
    out_file: '/var/log/playwright-mcp/out.log',

    // Environment
    env: {
      NODE_ENV: 'production',
      PLAYWRIGHT_BROWSERS_PATH: '/opt/playwright/browsers'
    }
  }]
};
```

**Start with PM2**:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Solution 11: Sidecar Cleanup Container (Kubernetes)

**Priority**: LOW
**Use Case**: Kubernetes with dedicated cleanup

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: playwright-mcp
spec:
  template:
    spec:
      shareProcessNamespace: true
      containers:
      - name: playwright-mcp
        image: playwright-mcp:latest
        # Main container config...

      - name: cleanup-sidecar
        image: busybox
        command:
        - /bin/sh
        - -c
        - |
          while true; do
            sleep 1800  # Every 30 minutes
            echo "Running Chrome cleanup..."
            pkill -f "chrome-headless" || true
            pkill -f "chromium" || true
            echo "Cleanup complete at $(date)"
          done
        securityContext:
          capabilities:
            add:
              - SYS_PTRACE
```

## Solution Summary Table

| # | Solution | Priority | Time | Complexity | Effectiveness |
|---|----------|----------|------|------------|---------------|
| 1 | Cron cleanup | HIGH | 5min | Low | Medium |
| 2 | Manual recovery | HIGH | N/A | Low | High |
| 3 | Systemd limits | MEDIUM | 30min | Medium | High |
| 4 | Isolated mode | HIGH | 10min | Low | High |
| 5 | Docker config | HIGH | 30min | Medium | High |
| 6 | Kubernetes config | MEDIUM | 1hr | Medium | High |
| 7 | Error handling | HIGH | 2hr | Medium | High |
| 8 | Browser pool | MEDIUM | 4hr | High | Very High |
| 9 | Monitoring | HIGH | 1hr | Medium | Medium |
| 10 | PM2 supervisor | MEDIUM | 1hr | Medium | High |
| 11 | K8s sidecar | LOW | 2hr | High | Medium |

## Recommended Implementation Order

1. **Immediate** (Day 1):
   - Enable isolated mode (Solution 4)
   - Add cron cleanup job (Solution 1)
   - Fix Docker configuration (Solution 5)

2. **Short-term** (Week 1):
   - Implement monitoring (Solution 9)
   - Add systemd limits (Solution 3)
   - Improve error handling (Solution 7)

3. **Medium-term** (Month 1):
   - Set up PM2 supervisor (Solution 10)
   - Implement browser pool (Solution 8)

4. **Long-term**:
   - Contribute fixes to upstream Playwright MCP
   - Consider alternative MCP implementations

## Verification Steps

After implementing solutions, verify effectiveness:

```bash
# 1. Check current Chrome processes
pgrep -c -f "chrome|chromium"

# 2. Monitor over time
watch -n 60 'pgrep -c -f "chrome|chromium"; free -m | head -2'

# 3. Check logs
tail -f /var/log/chrome-cleanup.log

# 4. Stress test
for i in {1..100}; do
    curl -X POST http://localhost:3000/api/browser/test
    sleep 1
done

# 5. Verify no accumulation
pgrep -c -f "chrome|chromium"
```
