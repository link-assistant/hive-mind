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
      test: ['CMD', 'node', '-e', 'process.exit(0)']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # Optional: Run solve commands in isolated containers
  solve-runner:
    build: .
    container_name: hive-solve-runner
    restart: 'no' # Don't auto-restart solve commands
    profiles:
      - solve # Only starts with: docker compose --profile solve run solve-runner
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - /tmp:/tmp
    # Automatic cleanup when container stops
    init: true # Ensures proper process cleanup
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

| Policy           | Behavior                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| `no`             | Never restart                                                           |
| `always`         | Always restart, even if manually stopped (restarts after reboot too)    |
| `unless-stopped` | Restart unless manually stopped (won't restart after reboot if stopped) |
| `on-failure`     | Only restart if container exits with non-zero code                      |

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
  apps: [
    {
      name: 'hive-telegram-bot',
      script: './src/telegram-bot.mjs',
      cwd: '/home/hive/hive-mind',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
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

## Solution 7: earlyoom / systemd-oomd -- Userspace OOM Protection (RECOMMENDED)

**Complexity**: Low
**Addresses**: RAM cleanup, system stability
**Recommended**: Yes

### Description

`earlyoom` is a lightweight daemon (~2 MiB memory) that monitors available memory 10 times per second and kills the highest `oom_score` process before the kernel OOM killer triggers. The kernel OOM killer activates very late (often when the system is already frozen), while earlyoom acts proactively at a configurable threshold. `systemd-oomd` is systemd's built-in alternative using Linux Pressure Stall Information (PSI).

### Implementation (earlyoom)

```bash
# Install earlyoom
sudo apt install earlyoom

# Enable and start
sudo systemctl enable --now earlyoom
```

Configure at `/etc/default/earlyoom`:

```bash
EARLYOOM_ARGS="-m 5 -r 60 --avoid '(^|/)(init|sshd|hive-telegram-bot)$' --prefer '(^|/)(chrome|node.*solve)$'"
```

Key flags:

- `-m 5`: Trigger when free memory falls below 5%
- `-r 60`: Log memory status every 60 seconds
- `--avoid`: Never kill these processes (protect the bot and system services)
- `--prefer`: Kill these first (Chrome and solve workers are expendable)

### Implementation (systemd-oomd alternative)

Add to any systemd service unit:

```ini
[Service]
ManagedOOMMemoryPressure=kill
ManagedOOMMemoryPressureLimit=80%
```

### Advantages

- Prevents system freezes caused by OOM before the kernel can react
- Configurable process priority (protect critical services, sacrifice workers)
- Minimal resource footprint
- earlyoom: single package install, no additional configuration needed

### Disadvantages

- earlyoom: kills processes based on heuristics, which may occasionally kill the wrong process
- systemd-oomd: requires cgroups v2 and PSI support (Linux 4.20+)

### References

- [earlyoom GitHub](https://github.com/rfjakob/earlyoom)
- [systemd-oomd documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd-oomd.service.html)

## Solution 8: Linux OOM Score Tuning

**Complexity**: Low
**Addresses**: RAM cleanup prioritization
**Recommended**: Yes (complement to other solutions)

### Description

The Linux kernel's OOM killer assigns each process a "badness score" based on memory usage. The `oom_score_adj` parameter (-1000 to +1000) allows manual adjustment of this score. By protecting critical services (like the telegram bot) and marking expendable processes (like solve workers), you ensure the right processes die first during memory pressure.

### Implementation

In the systemd service unit for the bot:

```ini
[Service]
# Protect the telegram bot from OOM killer (-900 makes it very unlikely to be killed)
OOMScoreAdjust=-900
```

For solve worker processes, use a wrapper:

```bash
#!/bin/bash
# solve-wrapper.sh - Run solve with high OOM score
echo 500 > /proc/self/oom_score_adj
exec node /home/hive/hive-mind/src/solve.mjs "$@"
```

Optional system-level tuning:

```bash
# Prevent memory overcommit (stricter allocation)
sudo sysctl -w vm.overcommit_memory=0

# Make persistent
echo "vm.overcommit_memory=0" | sudo tee -a /etc/sysctl.d/99-hive-mind.conf
```

### Advantages

- Zero additional dependencies (kernel feature)
- Ensures critical services survive OOM events
- Can be added with a single line in the systemd unit file

### Disadvantages

- Only affects behavior during OOM events, not proactive cleanup
- Does not prevent memory pressure from building up

### References

- [Linux OOM Killer Guide (Last9)](https://last9.io/blog/understanding-the-linux-oom-killer/)
- [Oracle: How to Configure the Linux OOM Killer](https://www.oracle.com/technical-resources/articles/it-infrastructure/dev-oom-killer.html)

## Solution 9: cgroups Resource Limits via systemd

**Complexity**: Medium
**Addresses**: CPU, RAM, and process isolation per service
**Recommended**: Yes

### Description

Linux cgroups (control groups) limit, account for, and isolate resource usage (CPU, memory, disk I/O, PIDs) of process collections. systemd provides native cgroup integration through service unit directives, requiring no additional tools.

### Implementation

Enhanced systemd service unit with cgroup limits:

```ini
[Service]
# Memory: hard limit, swap limit, high watermark
MemoryMax=1G
MemorySwapMax=0
MemoryHigh=768M

# CPU: 100% = 1 full CPU core
CPUQuota=100%

# Process count limit (prevents fork bombs)
TasksMax=100
```

For running solve commands in transient cgroup-limited scopes:

```bash
# Run a solve command with resource limits
systemd-run --user -u solve-task-$(date +%s) \
  -p CPUQuota=100% \
  -p MemoryMax=512M \
  -p TasksMax=50 \
  node /home/hive/hive-mind/src/solve.mjs "$@"
```

### Advantages

- Strong isolation without Docker
- Native systemd integration (just add directives to unit files)
- Prevents any single process from consuming all system resources
- `TasksMax` prevents fork bombs from exhausting the process table

### Disadvantages

- Requires understanding of cgroup hierarchy
- Limits may cause legitimate processes to be OOM-killed if set too low
- `systemd-run` approach adds complexity for ad-hoc commands

### References

- [Red Hat: Setting Resource Limits with Control Groups](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/8/html/managing_monitoring_and_updating_the_kernel/setting-limits-for-applications_managing-monitoring-and-updating-the-kernel)
- [iximiuz Labs: Controlling Process Resources with cgroups](https://labs.iximiuz.com/tutorials/controlling-process-resources-with-cgroups)

## Solution 10: logrotate for Log File Management (RECOMMENDED)

**Complexity**: Low
**Addresses**: Disk cleanup (log files)
**Recommended**: Yes (baseline requirement)

### Description

logrotate is a standard Linux utility that automatically rotates, compresses, and removes log files. It is pre-installed on virtually all Linux distributions and prevents log-driven disk exhaustion.

### Implementation

Create `/etc/logrotate.d/hive-mind`:

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
    postrotate
        systemctl reload hive-telegram-bot > /dev/null 2>&1 || true
    endscript
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

### Test Configuration

```bash
# Dry run to verify configuration
sudo logrotate -d /etc/logrotate.d/hive-mind

# Force rotation to test
sudo logrotate -f /etc/logrotate.d/hive-mind
```

### Advantages

- Pre-installed on all major Linux distributions
- Declarative configuration
- Compresses old logs automatically
- Prevents any single log file from consuming disk space

### Disadvantages

- Only manages log files, not other types of disk waste
- Runs on schedule (daily by default), not real-time

### References

- [Better Stack: Complete Guide to logrotate](https://betterstack.com/community/guides/logging/how-to-manage-log-files-with-logrotate-on-ubuntu-20-04/)
- [Datadog: How to Manage Log Files Using logrotate](https://www.datadoghq.com/blog/log-file-control-with-logrotate/)

## Solution 11: Monit -- Process and Resource Monitoring

**Complexity**: Low
**Addresses**: Service auto-restart, resource threshold alerts and actions
**Recommended**: Optional (complement to systemd)

### Description

Monit is an open-source process monitoring daemon that checks service health at configurable intervals and can automatically restart failed services, send alerts, and trigger actions when resource thresholds are crossed.

### Implementation

Install and configure:

```bash
sudo apt install monit
sudo systemctl enable --now monit
```

Create `/etc/monit/conf.d/hive-mind`:

```
# Monitor the telegram bot process
check process hive-telegram-bot matching "telegram-bot.mjs"
  start program = "/usr/bin/systemctl start hive-telegram-bot"
  stop program = "/usr/bin/systemctl stop hive-telegram-bot"
  if memory > 800 MB for 3 cycles then restart
  if cpu > 90% for 5 cycles then restart
  if 5 restarts within 5 cycles then timeout

# Monitor system resources
check system $HOST
  if loadavg (5min) > 8 then alert
  if memory usage > 80% for 4 cycles then alert
  if swap usage > 20% for 4 cycles then alert

# Monitor /tmp disk usage
check filesystem tmp with path /tmp
  if space usage > 80% then exec "/home/hive/scripts/cleanup.sh"
  if space usage > 95% then exec "/home/hive/scripts/aggressive-cleanup.sh"
```

### Advantages

- Lightweight (1-2% CPU/memory)
- Built-in web UI on port 2812 for status monitoring
- Resource-threshold-based actions that systemd alone does not provide
- Alert integration (email, custom scripts)

### Disadvantages

- Additional dependency to install and maintain
- Some overlap with systemd restart functionality
- Configuration syntax is unique and requires learning

### References

- [Monit Official Documentation](https://mmonit.com/monit/documentation/monit.html)
- [Monit Configuration Examples](https://mmonit.com/wiki/Monit/ConfigurationExamples)

## Solution 12: Resource Watchdog Service

**Complexity**: Medium
**Addresses**: Disk cleanup, RAM cleanup (threshold-based)
**Recommended**: Optional

### Description

A custom watchdog script that runs as a systemd service, continuously monitoring disk and memory usage and taking automated action when thresholds are crossed. This fills the gap between passive cron cleanup (scheduled) and reactive OOM killing (too late).

### Implementation

Create `/home/hive/scripts/resource-watchdog.sh`:

```bash
#!/bin/bash
# Resource Watchdog - runs as systemd service
DISK_THRESHOLD=80  # percent
MEM_THRESHOLD=80   # percent
CHECK_INTERVAL=30  # seconds

LOG_FILE="/var/log/hive-watchdog.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log "Resource watchdog started"

while true; do
    # Check disk
    DISK_PCT=$(df /tmp --output=pcent | tail -1 | tr -d ' %')
    if [ "$DISK_PCT" -gt "$DISK_THRESHOLD" ]; then
        log "Disk threshold exceeded: ${DISK_PCT}%"
        # Remove oldest solver directories first
        find /tmp -maxdepth 1 -name "gh-issue-solver-*" -type d \
            -printf '%T+ %p\n' | sort | head -5 | cut -d' ' -f2- | \
            xargs rm -rf 2>/dev/null
    fi

    # Check memory
    MEM_PCT=$(free | awk '/Mem:/ {printf "%.0f", $3/$2*100}')
    if [ "$MEM_PCT" -gt "$MEM_THRESHOLD" ]; then
        log "Memory threshold exceeded: ${MEM_PCT}%"
        # Kill oldest node solve processes
        pkill -f --oldest "solve.mjs" 2>/dev/null || true
    fi

    sleep "$CHECK_INTERVAL"
done
```

Create `/etc/systemd/system/resource-watchdog.service`:

```ini
[Unit]
Description=Hive Mind Resource Usage Watchdog
After=network.target

[Service]
Type=simple
User=hive
ExecStart=/home/hive/scripts/resource-watchdog.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
chmod +x /home/hive/scripts/resource-watchdog.sh
sudo systemctl daemon-reload
sudo systemctl enable --now resource-watchdog
```

### Advantages

- Continuous monitoring (30-second intervals vs 30-minute cron)
- Threshold-based actions (proactive, not just scheduled)
- Custom logic for determining what to clean/kill

### Disadvantages

- Custom code to maintain
- Requires careful threshold tuning to avoid killing legitimate work
- Overlap with Monit (which provides similar functionality out of the box)

## Solution 13: Supervisord (Alternative Process Manager)

**Complexity**: Low-Medium
**Addresses**: Service auto-restart
**Recommended**: Optional (if not using systemd)

### Description

Supervisord is a process control system for UNIX written in Python. It monitors and controls managed processes, restarting them on crash. It is an alternative to systemd for environments where systemd is not available or preferred.

### Implementation

```bash
sudo apt install supervisor
```

Create `/etc/supervisor/conf.d/hive-telegram-bot.conf`:

```ini
[program:hive-telegram-bot]
command=/usr/bin/node /home/hive/hive-mind/src/telegram-bot.mjs
directory=/home/hive/hive-mind
user=hive
autostart=true
autorestart=true
startretries=3
stderr_logfile=/var/log/hive-telegram-bot.err.log
stdout_logfile=/var/log/hive-telegram-bot.out.log
environment=NODE_ENV="production"
```

```bash
sudo supervisorctl reload
sudo supervisorctl status
```

### Advantages

- Does not require root for process management (user-level daemon possible)
- Simple INI-style configuration
- Good for managing multiple application processes

### Disadvantages

- Largely redundant with systemd on modern Linux
- Additional Python dependency
- Less integrated with system logging than systemd

## Solution 14: incron -- Event-Driven File Cleanup

**Complexity**: Medium
**Addresses**: Disk cleanup (real-time, event-driven)
**Recommended**: Optional

### Description

incron triggers commands based on filesystem events (file creation, modification, deletion) using the Linux inotify kernel subsystem. Unlike cron which runs on a schedule, incron reacts in real-time.

### Implementation

```bash
sudo apt install incron
echo "hive" | sudo tee /etc/incron.allow
```

Edit incrontab (`incrontab -e`):

```
# Monitor /tmp for new solver directories
/tmp IN_CREATE /home/hive/scripts/on-tmp-create.sh $@/$#

# Auto-reload bot config when .env changes
/home/hive/hive-mind/.env IN_CLOSE_WRITE systemctl restart hive-telegram-bot
```

### Advantages

- Real-time response to filesystem events
- No polling overhead
- Can trigger cleanup immediately after solve commands finish

### Disadvantages

- More complex to configure correctly
- Risk of event loops if handlers write to watched directories
- inotify watch limits may be reached on busy systems

### References

- [incron GitHub](https://github.com/ar-/incron)
- [ArchWiki: Incron](https://wiki.archlinux.org/title/Incron)

## Solution 15: Kubernetes Liveness Probes and Resource Limits

**Complexity**: High
**Addresses**: Service auto-restart, resource isolation
**Recommended**: No (for single-server setups; yes if Kubernetes already in use)

### Description

Kubernetes provides health probes (liveness, readiness, startup) that detect when a container is stuck and trigger automatic restarts. Per-pod resource limits enforce CPU and memory boundaries using cgroups.

### Implementation

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hive-telegram-bot
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: hive-telegram-bot
          image: hive-mind:latest
          resources:
            requests:
              memory: '256Mi'
              cpu: '250m'
            limits:
              memory: '1Gi'
              cpu: '1000m'
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
```

### Advantages

- Industry-standard container orchestration
- Built-in health checking and auto-healing
- Resource limits per container

### Disadvantages

- Significant operational overhead for a single-server setup
- Requires container image builds and registry
- k3s reduces overhead but is still more complex than bare-metal solutions

### References

- [Kubernetes: Configure Liveness Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Kubernetes: Resource Management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)

## Solution Comparison Matrix

| Solution                 | Auto-Restart |  Disk Cleanup   |   RAM Cleanup    |  CPU Control   | Process Cleanup | Complexity |     Dependencies     |
| ------------------------ | :----------: | :-------------: | :--------------: | :------------: | :-------------: | :--------: | :------------------: |
| 1. systemd service       |     Yes      |       No        |        No        |       No       |       No        |    Low     |         None         |
| 2. Docker Compose        |     Yes      |       No        |     Partial      |      Yes       |       Yes       |   Medium   |        Docker        |
| 3. Cron cleanup          |      No      |       Yes       |        No        |       No       |       Yes       |    Low     |         None         |
| 4. systemd-tmpfiles      |      No      |       Yes       |        No        |       No       |       No        |    Low     |         None         |
| 5. Safe reboot           |     Yes      |       Yes       |       Yes        |      Yes       |       Yes       |   Medium   |         None         |
| 6. PM2                   |     Yes      |       No        |        No        |       No       |       No        |   Medium   |         PM2          |
| 7. earlyoom/systemd-oomd |      No      |       No        |       Yes        |       No       |       Yes       |    Low     |     earlyoom pkg     |
| 8. OOM score tuning      |      No      |       No        |  Yes (priority)  |       No       |       No        |    Low     |         None         |
| 9. cgroups via systemd   |      No      |       No        | Yes (hard limit) |      Yes       | Yes (TasksMax)  |   Medium   |         None         |
| 10. logrotate            |      No      |   Yes (logs)    |        No        |       No       |       No        |    Low     | None (pre-installed) |
| 11. Monit                |     Yes      | Yes (threshold) | Yes (threshold)  |     Alert      |      Alert      |    Low     |      monit pkg       |
| 12. Resource watchdog    |      No      | Yes (threshold) | Yes (threshold)  |       No       |       Yes       |   Medium   |         None         |
| 13. Supervisord          |     Yes      |       No        |        No        |       No       |       No        | Low-Medium |    supervisor pkg    |
| 14. incron               |      No      | Yes (real-time) |        No        |       No       |       No        |   Medium   |      incron pkg      |
| 15. Kubernetes           |     Yes      |       No        |  Yes (eviction)  | Yes (throttle) |       Yes       |    High    |      Kubernetes      |

## Recommended Combination

For a comprehensive solution on a small-to-medium server, combine these tiers:

### Tier 1: Essential (Recommended for all setups)

1. **systemd service** (Solution 1) for telegram bot auto-restart
2. **Cron cleanup jobs** (Solution 3) for periodic resource cleanup
3. **systemd-tmpfiles** (Solution 4) for automated /tmp management
4. **earlyoom** (Solution 7) for proactive OOM prevention
5. **OOM score tuning** (Solution 8) to protect critical services during OOM
6. **logrotate** (Solution 10) for log file management

### Tier 2: Recommended Enhancements

7. **cgroups via systemd** (Solution 9) for per-service resource isolation
8. **Safe reboot script** (Solution 5) for weekly maintenance (optional)

### Tier 3: Advanced (Choose based on infrastructure)

9. **Monit** (Solution 11) if you need threshold-based alerting and web UI
10. **Docker Compose** (Solution 2) if already using Docker
11. **Kubernetes** (Solution 15) only if Kubernetes is already in use

This combination provides:

- Automatic bot restart on boot and crash
- Regular cleanup of disk, processes, and log files
- Proactive OOM protection with prioritized process killing
- Per-service resource isolation via cgroups
- Mostly native Linux tools with minimal additional dependencies
- Predictable maintenance windows
