# Proposed Solutions

## Overview

This document presents multiple solutions to address the auto-cleanup and service auto-restart requirements. Solutions are organized by complexity and can be combined for a comprehensive approach.

## Solution 1: systemd Service for Telegram Bot (RECOMMENDED)

**Complexity**: Low
**Addresses**: Service restart after reboot
**Recommended**: Yes

### Description

Create a systemd service unit that starts the `hive-telegram-bot` automatically on boot and restarts it if it crashes.

### Implementation

Create `/etc/systemd/system/hive-telegram-bot.service`:

```ini
[Unit]
Description=Hive Mind Telegram Bot
Documentation=https://github.com/link-assistant/hive-mind
After=network.target

[Service]
Type=simple
User=hive
WorkingDirectory=/home/hive/hive-mind
ExecStart=/usr/bin/node /home/hive/hive-mind/src/telegram-bot.mjs
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hive-telegram-bot

# Environment variables (adjust paths as needed)
Environment=NODE_ENV=production
EnvironmentFile=-/home/hive/hive-mind/.env

# Resource limits (optional)
MemoryMax=1G
CPUQuota=100%

[Install]
WantedBy=multi-user.target
```

### Setup Commands

```bash
# Create the service file
sudo nano /etc/systemd/system/hive-telegram-bot.service

# Reload systemd
sudo systemctl daemon-reload

# Enable the service (starts on boot)
sudo systemctl enable hive-telegram-bot

# Start the service now
sudo systemctl start hive-telegram-bot

# Check status
sudo systemctl status hive-telegram-bot

# View logs
sudo journalctl -u hive-telegram-bot -f
```

### Advantages

- Native Linux solution, no additional dependencies
- Automatic restart on failure
- Proper logging via journald
- Resource limits can be configured
- Easy to manage with standard systemctl commands

### Disadvantages

- Requires root access to set up
- Configuration is system-specific

## Solution 2: Docker Compose with Restart Policies (RECOMMENDED)

**Complexity**: Medium
**Addresses**: Service restart, resource isolation
**Recommended**: Yes (if Docker already in use)

### Description

Deploy the telegram bot in a Docker container with `restart: unless-stopped` or `restart: always` policy.

### Implementation

Update or create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  hive-telegram-bot:
    build: .
    container_name: hive-telegram-bot
    restart: unless-stopped
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./data:/app/data
    # Optional resource limits
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '1.0'
    healthcheck:
      test: ["CMD", "node", "-e", "process.exit(0)"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # Optional: Run solve commands in isolated containers
  solve-runner:
    build: .
    container_name: hive-solve-runner
    restart: "no"  # Don't auto-restart solve commands
    profiles:
      - solve  # Only starts with: docker compose --profile solve run solve-runner
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - /tmp:/tmp
    # Automatic cleanup when container stops
    init: true  # Ensures proper process cleanup
```

### Setup Commands

```bash
# Start the bot
docker compose up -d hive-telegram-bot

# View logs
docker compose logs -f hive-telegram-bot

# Restart
docker compose restart hive-telegram-bot

# Stop
docker compose down
```

### With Restart Policy Details

| Policy | Behavior |
|--------|----------|
| `no` | Never restart |
| `always` | Always restart, even if manually stopped (restarts after reboot too) |
| `unless-stopped` | Restart unless manually stopped (won't restart after reboot if stopped) |
| `on-failure` | Only restart if container exits with non-zero code |

### Advantages

- Container isolation limits resource impact
- `--init` flag properly reaps zombie processes
- Easy to add health checks
- Portable configuration

### Disadvantages

- Requires Docker installation
- Slight overhead compared to native
- Volume mounting needed for persistent data

## Solution 3: Cron-Based Cleanup Jobs (RECOMMENDED)

**Complexity**: Low
**Addresses**: Disk cleanup, process cleanup
**Recommended**: Yes

### Description

Use cron jobs to periodically clean up `/tmp` directories and orphaned processes.

### Implementation

Create `/home/hive/scripts/cleanup.sh`:

```bash
#!/bin/bash
# Hive Mind Cleanup Script
# Run via cron to clean up accumulated resources

set -e

LOG_FILE="/var/log/hive-cleanup.log"
MAX_DIR_AGE_HOURS=24
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

log() {
    echo "[$TIMESTAMP] $1" >> "$LOG_FILE"
}

log "Starting cleanup..."

# 1. Clean up old working directories in /tmp
log "Cleaning old working directories..."
find /tmp -maxdepth 1 -name "gh-issue-solver-*" -type d -mmin +$((MAX_DIR_AGE_HOURS * 60)) -exec rm -rf {} \; 2>/dev/null || true
DIRS_CLEANED=$(find /tmp -maxdepth 1 -name "gh-issue-solver-*" -type d 2>/dev/null | wc -l)
log "Remaining working directories: $DIRS_CLEANED"

# 2. Clean up orphaned Chrome processes (from Playwright MCP)
log "Checking for orphaned Chrome processes..."
CHROME_COUNT=$(pgrep -f "chrome-headless" 2>/dev/null | wc -l || echo 0)
if [ "$CHROME_COUNT" -gt 10 ]; then
    log "Found $CHROME_COUNT Chrome processes, killing old ones..."
    pkill -f "chrome-headless" 2>/dev/null || true
    sleep 5
    pkill -9 -f "chrome-headless" 2>/dev/null || true
    log "Chrome cleanup complete"
fi

# 3. Clean up npm cache directories
log "Cleaning npm cache directories..."
find /tmp -maxdepth 1 -name "npm-*" -type d -mmin +60 -exec rm -rf {} \; 2>/dev/null || true

# 4. Clean up playwright temp directories
log "Cleaning playwright temp directories..."
find /tmp -maxdepth 1 -name "playwright*" -type d -mmin +60 -exec rm -rf {} \; 2>/dev/null || true

# 5. Report disk usage
DISK_USAGE=$(df -h /tmp | tail -1 | awk '{print $5}')
log "Current /tmp usage: $DISK_USAGE"

# 6. Report memory usage
MEM_USAGE=$(free -m | awk '/Mem:/ {printf "%.1f%%", $3/$2*100}')
log "Current memory usage: $MEM_USAGE"

# 7. Count zombie processes
ZOMBIE_COUNT=$(ps aux | grep -c ' Z' || echo 0)
if [ "$ZOMBIE_COUNT" -gt 5 ]; then
    log "Warning: $ZOMBIE_COUNT zombie processes detected"
fi

log "Cleanup complete"
```

### Crontab Entry

```bash
# Edit crontab
crontab -e

# Add these lines:

# Run cleanup every 30 minutes
*/30 * * * * /home/hive/scripts/cleanup.sh

# Daily aggressive cleanup at 3 AM
0 3 * * * /home/hive/scripts/aggressive-cleanup.sh
```

### Aggressive Cleanup Script

Create `/home/hive/scripts/aggressive-cleanup.sh`:

```bash
#!/bin/bash
# Aggressive cleanup - runs daily during maintenance window

LOG_FILE="/var/log/hive-cleanup.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

log() {
    echo "[$TIMESTAMP] $1" >> "$LOG_FILE"
}

log "Starting aggressive cleanup..."

# Check if any solve commands are running
SOLVE_COUNT=$(pgrep -f "solve.mjs" 2>/dev/null | wc -l || echo 0)

if [ "$SOLVE_COUNT" -gt 0 ]; then
    log "Warning: $SOLVE_COUNT solve commands running, skipping aggressive cleanup"
    exit 0
fi

# Clean ALL working directories (regardless of age)
log "Removing all working directories..."
rm -rf /tmp/gh-issue-solver-* 2>/dev/null || true

# Kill all orphaned node processes older than 2 hours
log "Killing old node processes..."
for pid in $(ps -eo pid,etimes,comm | grep node | awk '$2 > 7200 {print $1}'); do
    kill -15 "$pid" 2>/dev/null || true
done

# Force GC on node processes (if any are still running)
log "Cleanup complete"
```

### Advantages

- Simple to implement and understand
- No additional dependencies
- Customizable timing and aggressiveness
- Works with existing infrastructure

### Disadvantages

- Not real-time - runs on schedule
- Requires root for some operations
- Log management needed

## Solution 4: systemd-tmpfiles Configuration (RECOMMENDED)

**Complexity**: Low
**Addresses**: Disk cleanup
**Recommended**: Yes

### Description

Configure systemd-tmpfiles to automatically clean working directories after a shorter period than the default 10 days.

### Implementation

Create `/etc/tmpfiles.d/hive-mind.conf`:

```
# Hive Mind temporary files configuration
# Clean gh-issue-solver directories after 1 day
D /tmp/gh-issue-solver-* 0755 hive hive 1d

# Clean playwright temp directories after 1 hour
D /tmp/playwright* 0755 - - 1h

# Clean npm temp directories after 1 hour
D /tmp/npm-* 0755 - - 1h

# Clean chromium temp directories after 1 hour
D /tmp/chromium-* 0755 - - 1h
```

### Format Explanation

```
Type Path Mode User Group Age
D    /tmp/xyz 0755 hive hive 1d

Type:
  d = create directory
  D = create and clean directory
  x = exclude from cleaning (ignore)
  X = exclude from cleaning including subdirs

Age:
  s = seconds
  m = minutes
  h = hours
  d = days
  w = weeks
```

### Activate Configuration

```bash
# Create the configuration file
sudo nano /etc/tmpfiles.d/hive-mind.conf

# Test the configuration
sudo systemd-tmpfiles --clean --dry-run

# Apply immediately
sudo systemd-tmpfiles --clean

# Check timer status
systemctl status systemd-tmpfiles-clean.timer
```

### Default Timer Schedule

The `systemd-tmpfiles-clean.timer` runs:
- 15 minutes after boot
- Then daily (every 24 hours)

To run more frequently, override the timer:

```bash
# Create override
sudo systemctl edit systemd-tmpfiles-clean.timer

# Add:
[Timer]
OnUnitActiveSec=1h
```

### Advantages

- Native systemd mechanism
- Works automatically without additional scripts
- Integrates with system logging
- Can be customized per-directory

### Disadvantages

- Only cleans based on file age, not other criteria
- Runs on timer, not real-time
- Configuration syntax can be confusing

## Solution 5: Safe Reboot Mechanism

**Complexity**: Medium
**Addresses**: Safe reboot timing
**Recommended**: Optional

### Description

Implement a mechanism to safely reboot the server only when no solve/hive commands are running.

### Implementation

Create `/home/hive/scripts/safe-reboot.sh`:

```bash
#!/bin/bash
# Safe reboot script - only reboots when no solve commands running

LOG_FILE="/var/log/hive-cleanup.log"
LOCKFILE="/var/run/hive-safe-reboot.lock"
MAX_WAIT_HOURS=2

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check for existing lock
if [ -f "$LOCKFILE" ]; then
    log "Safe reboot already in progress, exiting"
    exit 0
fi

# Create lock file
touch "$LOCKFILE"
trap "rm -f $LOCKFILE" EXIT

log "Safe reboot initiated, waiting for commands to finish..."

# Wait for solve commands to finish
WAIT_START=$(date +%s)
MAX_WAIT_SECONDS=$((MAX_WAIT_HOURS * 3600))

while true; do
    SOLVE_COUNT=$(pgrep -f "solve.mjs" 2>/dev/null | wc -l || echo 0)
    HIVE_COUNT=$(pgrep -f "hive.mjs" 2>/dev/null | wc -l || echo 0)
    TOTAL=$((SOLVE_COUNT + HIVE_COUNT))

    if [ "$TOTAL" -eq 0 ]; then
        log "No commands running, proceeding with reboot"
        break
    fi

    ELAPSED=$(($(date +%s) - WAIT_START))
    if [ "$ELAPSED" -gt "$MAX_WAIT_SECONDS" ]; then
        log "Max wait time exceeded, $TOTAL commands still running. Aborting."
        exit 1
    fi

    log "Waiting for $TOTAL commands to finish (waited ${ELAPSED}s)..."
    sleep 60
done

# Perform cleanup before reboot
log "Running pre-reboot cleanup..."
/home/hive/scripts/aggressive-cleanup.sh

# Reboot
log "Rebooting system..."
sudo reboot
```

### Schedule Weekly Safe Reboot

```bash
# Add to crontab
# Weekly safe reboot on Sunday at 4 AM
0 4 * * 0 /home/hive/scripts/safe-reboot.sh
```

### Advantages

- Ensures no work is lost during reboot
- Combines cleanup with reboot
- Can be scheduled for maintenance windows

### Disadvantages

- Reboot may be delayed indefinitely if commands always running
- Requires coordination with systemd service for bot restart

## Solution 6: Process Manager (PM2) Alternative

**Complexity**: Medium
**Addresses**: Process management, auto-restart
**Recommended**: Optional (if not using systemd)

### Description

Use PM2 (Node.js process manager) to manage the telegram bot and other Node.js services.

### Implementation

```bash
# Install PM2 globally
npm install -g pm2

# Start the bot with PM2
pm2 start /home/hive/hive-mind/src/telegram-bot.mjs --name "hive-telegram-bot"

# Enable startup script (runs on boot)
pm2 startup

# Save current process list
pm2 save

# View status
pm2 status

# View logs
pm2 logs hive-telegram-bot

# Restart
pm2 restart hive-telegram-bot
```

### PM2 Ecosystem File

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'hive-telegram-bot',
    script: './src/telegram-bot.mjs',
    cwd: '/home/hive/hive-mind',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

### Advantages

- Node.js native process manager
- Built-in log management
- Easy clustering support
- Good monitoring dashboard (pm2 monit)

### Disadvantages

- Additional dependency
- Not as integrated as systemd
- Requires separate installation

## Solution Comparison Matrix

| Solution | Auto-Restart | Disk Cleanup | Process Cleanup | Complexity | Dependencies |
|----------|--------------|--------------|-----------------|------------|--------------|
| systemd service | Yes | No | No | Low | None |
| Docker Compose | Yes | No | Partial | Medium | Docker |
| Cron cleanup | No | Yes | Yes | Low | None |
| systemd-tmpfiles | No | Yes | No | Low | None |
| Safe reboot | Yes | Yes | Yes | Medium | None |
| PM2 | Yes | No | No | Medium | PM2 |

## Recommended Combination

For a comprehensive solution, combine:

1. **systemd service** for telegram bot auto-restart
2. **Cron cleanup jobs** for periodic resource cleanup
3. **systemd-tmpfiles** for automated /tmp management
4. **Safe reboot script** for weekly maintenance (optional)

This provides:
- Automatic bot restart on boot
- Regular cleanup of disk and processes
- Native Linux tools with no additional dependencies
- Predictable maintenance windows
