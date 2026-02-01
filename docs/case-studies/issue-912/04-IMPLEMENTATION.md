# Implementation Guide

## Overview

This guide provides step-by-step instructions to implement the recommended solutions for auto-cleanup and service auto-restart.

## Prerequisites

- Ubuntu/Debian-based Linux server (or adapt commands for your distro)
- Root or sudo access
- Hive Mind installed at `/home/hive/hive-mind`
- Node.js 18+ installed

## Step 1: Create systemd Service for Telegram Bot

### 1.1 Create the Service File

```bash
sudo nano /etc/systemd/system/hive-telegram-bot.service
```

Paste the following content:

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

# Load environment from .env file
EnvironmentFile=-/home/hive/hive-mind/.env

# Optional resource limits
MemoryMax=1G

[Install]
WantedBy=multi-user.target
```

### 1.2 Enable and Start the Service

```bash
# Reload systemd to recognize new service
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable hive-telegram-bot

# Start the service now
sudo systemctl start hive-telegram-bot

# Verify it's running
sudo systemctl status hive-telegram-bot
```

### 1.3 Managing the Service

```bash
# View logs
sudo journalctl -u hive-telegram-bot -f

# Restart the service
sudo systemctl restart hive-telegram-bot

# Stop the service
sudo systemctl stop hive-telegram-bot

# Disable auto-start
sudo systemctl disable hive-telegram-bot
```

### 1.4 Transition from Screen

If you were using `screen -S bot`:

```bash
# 1. Stop the screen session (if still running)
screen -r bot
# Press Ctrl+C to stop the bot
# Press Ctrl+A, then K, then Y to kill the screen session

# 2. Start the systemd service
sudo systemctl start hive-telegram-bot

# 3. Verify
sudo systemctl status hive-telegram-bot
```

## Step 2: Set Up Cleanup Scripts

### 2.1 Create Scripts Directory

```bash
mkdir -p /home/hive/scripts
```

### 2.2 Create Main Cleanup Script

```bash
nano /home/hive/scripts/cleanup.sh
```

Paste:

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

# 2. Clean up orphaned Chrome processes (from Playwright MCP)
CHROME_COUNT=$(pgrep -f "chrome-headless" 2>/dev/null | wc -l || echo 0)
if [ "$CHROME_COUNT" -gt 10 ]; then
    log "Found $CHROME_COUNT Chrome processes, killing old ones..."
    pkill -f "chrome-headless" 2>/dev/null || true
    sleep 5
    pkill -9 -f "chrome-headless" 2>/dev/null || true
fi

# 3. Clean up temp directories
find /tmp -maxdepth 1 -name "npm-*" -type d -mmin +60 -exec rm -rf {} \; 2>/dev/null || true
find /tmp -maxdepth 1 -name "playwright*" -type d -mmin +60 -exec rm -rf {} \; 2>/dev/null || true

# 4. Report status
DISK_USAGE=$(df -h /tmp | tail -1 | awk '{print $5}')
log "Cleanup complete. /tmp usage: $DISK_USAGE"
```

Make executable:

```bash
chmod +x /home/hive/scripts/cleanup.sh
```

### 2.3 Create Aggressive Cleanup Script

```bash
nano /home/hive/scripts/aggressive-cleanup.sh
```

Paste:

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

# Clean ALL old working directories
rm -rf /tmp/gh-issue-solver-* 2>/dev/null || true

# Clean all npm and playwright temp
rm -rf /tmp/npm-* 2>/dev/null || true
rm -rf /tmp/playwright* 2>/dev/null || true

log "Aggressive cleanup complete"
```

Make executable:

```bash
chmod +x /home/hive/scripts/aggressive-cleanup.sh
```

### 2.4 Create Log File with Proper Permissions

```bash
sudo touch /var/log/hive-cleanup.log
sudo chown hive:hive /var/log/hive-cleanup.log
```

## Step 3: Configure Cron Jobs

### 3.1 Edit Crontab

```bash
crontab -e
```

Add these lines:

```cron
# Hive Mind Cleanup Jobs

# Run cleanup every 30 minutes
*/30 * * * * /home/hive/scripts/cleanup.sh

# Daily aggressive cleanup at 3 AM
0 3 * * * /home/hive/scripts/aggressive-cleanup.sh

# Weekly log rotation (keep last 7 days)
0 0 * * 0 find /var/log -name "hive-*.log" -mtime +7 -delete
```

### 3.2 Verify Cron Jobs

```bash
# List current cron jobs
crontab -l

# Check cron service is running
sudo systemctl status cron
```

## Step 4: Configure systemd-tmpfiles

### 4.1 Create Configuration File

```bash
sudo nano /etc/tmpfiles.d/hive-mind.conf
```

Paste:

```
# Hive Mind temporary files configuration
# Clean gh-issue-solver directories after 1 day (age based on modification time)
e /tmp/gh-issue-solver-* - - - 1d

# Clean playwright temp directories after 1 hour
e /tmp/playwright* - - - 1h

# Clean npm temp directories after 1 hour
e /tmp/npm-* - - - 1h

# Clean chromium temp directories after 1 hour
e /tmp/chromium-* - - - 1h
```

### 4.2 Test Configuration

```bash
# Dry run to see what would be cleaned
sudo systemd-tmpfiles --clean --dry-run

# Apply the configuration immediately
sudo systemd-tmpfiles --clean
```

### 4.3 Optional: Run More Frequently

By default, systemd-tmpfiles runs daily. To run every hour:

```bash
sudo systemctl edit systemd-tmpfiles-clean.timer
```

Add:

```ini
[Timer]
OnBootSec=15min
OnUnitActiveSec=1h
```

Then reload:

```bash
sudo systemctl daemon-reload
sudo systemctl restart systemd-tmpfiles-clean.timer
```

## Step 5: Set Up Safe Reboot (Optional)

### 5.1 Create Safe Reboot Script

```bash
nano /home/hive/scripts/safe-reboot.sh
```

Paste:

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
sudo touch "$LOCKFILE"
trap "sudo rm -f $LOCKFILE" EXIT

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

Make executable:

```bash
chmod +x /home/hive/scripts/safe-reboot.sh
```

### 5.2 Schedule Weekly Safe Reboot (Optional)

```bash
crontab -e
```

Add:

```cron
# Weekly safe reboot on Sunday at 4 AM
0 4 * * 0 /home/hive/scripts/safe-reboot.sh
```

### 5.3 Configure Sudoers for Passwordless Reboot

```bash
sudo visudo
```

Add at the end:

```
hive ALL=(ALL) NOPASSWD: /sbin/reboot
hive ALL=(ALL) NOPASSWD: /usr/bin/touch /var/run/hive-safe-reboot.lock
hive ALL=(ALL) NOPASSWD: /usr/bin/rm -f /var/run/hive-safe-reboot.lock
```

## Step 9: Verification

### 9.1 Verify systemd Service

```bash
# Check service is enabled
sudo systemctl is-enabled hive-telegram-bot

# Check service is running
sudo systemctl is-active hive-telegram-bot

# View recent logs
sudo journalctl -u hive-telegram-bot --since "1 hour ago"
```

### 9.2 Test Cleanup Scripts

```bash
# Run cleanup manually
/home/hive/scripts/cleanup.sh

# Check the log
tail -20 /var/log/hive-cleanup.log
```

### 9.3 Verify Cron

```bash
# Check cron logs
sudo grep CRON /var/log/syslog | tail -20
```

### 9.4 Test Reboot Recovery

```bash
# 1. Reboot the server
sudo reboot

# 2. After reboot, verify bot is running
sudo systemctl status hive-telegram-bot
```

## Step 6: Install earlyoom for OOM Protection

### 6.1 Install and Configure

```bash
# Install earlyoom
sudo apt install earlyoom
```

### 6.2 Configure earlyoom

```bash
sudo nano /etc/default/earlyoom
```

Add:

```bash
EARLYOOM_ARGS="-m 5 -r 60 --avoid '(^|/)(init|sshd|hive-telegram-bot)$' --prefer '(^|/)(chrome|node.*solve)$'"
```

### 6.3 Enable and Start

```bash
sudo systemctl enable --now earlyoom
sudo systemctl status earlyoom
```

## Step 7: Configure OOM Score and cgroup Limits

### 7.1 Update systemd Service with OOM and cgroup Settings

Edit the existing bot service:

```bash
sudo systemctl edit hive-telegram-bot
```

Add these overrides:

```ini
[Service]
# Protect from OOM killer
OOMScoreAdjust=-900

# cgroup resource limits
MemoryMax=1G
MemorySwapMax=0
MemoryHigh=768M
CPUQuota=100%
TasksMax=100
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart hive-telegram-bot
```

## Step 8: Configure logrotate

### 8.1 Create logrotate Configuration

```bash
sudo nano /etc/logrotate.d/hive-mind
```

Paste:

```
/var/log/hive-*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    maxage 30
    size 100M
    create 660 hive hive
}

/home/hive/hive-mind/logs/*.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
    maxsize 50M
}
```

### 8.2 Test Configuration

```bash
# Dry run
sudo logrotate -d /etc/logrotate.d/hive-mind

# Force rotation to verify
sudo logrotate -f /etc/logrotate.d/hive-mind
```

## Monitoring and Alerting (Optional)

### Simple Disk Space Alert

Add to crontab:

```bash
# Check disk space every hour, alert if > 80%
0 * * * * df -h /tmp | awk 'NR==2 {gsub(/%/,""); if($5>80) print "WARNING: /tmp at "$5"% usage"}' | mail -s "Disk Alert" admin@example.com
```

### Health Check Script

Create `/home/hive/scripts/health-check.sh`:

```bash
#!/bin/bash
# Health check script

echo "=== Hive Mind Health Check ==="
echo "Date: $(date)"
echo ""

echo "=== Service Status ==="
systemctl is-active hive-telegram-bot && echo "Bot: Running" || echo "Bot: STOPPED"

echo ""
echo "=== Resource Usage ==="
echo "Disk /tmp: $(df -h /tmp | tail -1 | awk '{print $5}')"
echo "Memory: $(free -m | awk '/Mem:/ {printf "%.1f%%", $3/$2*100}')"
echo "Load: $(uptime | awk -F'average:' '{print $2}')"

echo ""
echo "=== Process Counts ==="
echo "Solve commands: $(pgrep -f solve.mjs | wc -l)"
echo "Hive commands: $(pgrep -f hive.mjs | wc -l)"
echo "Chrome processes: $(pgrep -f chrome | wc -l)"
echo "Zombie processes: $(ps aux | grep -c ' Z')"

echo ""
echo "=== Working Directories ==="
echo "Count: $(ls -d /tmp/gh-issue-solver-* 2>/dev/null | wc -l)"
echo "Total size: $(du -sh /tmp/gh-issue-solver-* 2>/dev/null | tail -1 | awk '{print $1}' || echo 0)"
```

Make executable and run:

```bash
chmod +x /home/hive/scripts/health-check.sh
/home/hive/scripts/health-check.sh
```

## Troubleshooting

### Bot Not Starting After Reboot

```bash
# Check service status
sudo systemctl status hive-telegram-bot

# View detailed logs
sudo journalctl -u hive-telegram-bot -n 50

# Common issues:
# - Wrong path to node or script
# - Missing .env file
# - Permission issues
```

### Cleanup Not Running

```bash
# Check cron is running
sudo systemctl status cron

# Check cron logs
sudo grep hive /var/log/syslog

# Run manually with verbose
bash -x /home/hive/scripts/cleanup.sh
```

### tmpfiles Not Cleaning

```bash
# Test configuration
sudo systemd-tmpfiles --clean --dry-run /etc/tmpfiles.d/hive-mind.conf

# Check timer
systemctl status systemd-tmpfiles-clean.timer
```

## Summary Checklist

### Tier 1: Essential

- [ ] Created `/etc/systemd/system/hive-telegram-bot.service`
- [ ] Enabled and started the systemd service
- [ ] Created `/home/hive/scripts/cleanup.sh`
- [ ] Created `/home/hive/scripts/aggressive-cleanup.sh`
- [ ] Added cron jobs for cleanup scripts
- [ ] Created `/etc/tmpfiles.d/hive-mind.conf`
- [ ] Installed and configured earlyoom
- [ ] Added `OOMScoreAdjust=-900` to bot service
- [ ] Added cgroup limits (`MemoryMax`, `CPUQuota`, `TasksMax`) to bot service
- [ ] Created `/etc/logrotate.d/hive-mind`

### Tier 2: Recommended

- [ ] (Optional) Created safe reboot script
- [ ] (Optional) Configured sudoers for passwordless reboot

### Verification

- [ ] Verified all services are working
- [ ] Tested reboot recovery
- [ ] Verified earlyoom protects bot process
- [ ] Verified logrotate configuration with dry run
