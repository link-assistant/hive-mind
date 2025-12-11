# Timeline and Sequence of Events

## Resource Accumulation Pattern

This document describes how resources accumulate over time on a Hive Mind server, leading to eventual service degradation.

## Typical Server Lifecycle

### Day 0: Fresh Server State

```
System Resources:
├── Disk (/tmp): ~5% used
├── RAM: ~30% used
├── Processes: ~100
└── Load Average: < 1.0

Services Running:
├── hive-telegram-bot (in screen session "bot")
└── System services
```

### Days 1-3: Normal Operation

Each `solve` command execution:

1. **Clone repository** to `/tmp/gh-issue-solver-{timestamp}`
2. **Install dependencies** (npm install creates node_modules)
3. **Spawn Claude Code** or other AI tools as child processes
4. **Run CI checks** which may spawn additional processes
5. **Cleanup** (attempted but may be incomplete)

```
Accumulated per solve:
├── /tmp directory: +100MB to +2GB (depending on repo size)
├── Processes: +0 to +5 (orphaned on failure)
└── Node.js workers: +0 to +3
```

### Days 4-7: Resource Buildup

```
System Resources:
├── Disk (/tmp): ~40% used (40GB of temporary files)
├── RAM: ~60% used
├── Processes: ~250
└── Load Average: 2.0-4.0

Orphaned Processes:
├── node (from failed solve commands): 10-20
├── chrome-headless (from Playwright MCP): 5-15
└── git (hanging operations): 2-5
```

### Days 7-14: Critical State

```
System Resources:
├── Disk (/tmp): ~80% used
├── RAM: ~85% used
├── Processes: ~400+
└── Load Average: 10.0+

Symptoms:
├── Some solve commands fail with ENOSPC
├── System becomes sluggish
├── SSH sessions may time out
└── Bot responses become slow
```

### Day 14+: Service Failure

```
System Resources:
├── Disk (/tmp): 100% used
├── RAM: 95%+ used (swapping heavily)
├── Processes: 500+
└── Load Average: 20.0+

Symptoms:
├── All solve commands fail
├── OOM killer starts terminating processes
├── Bot may crash or become unresponsive
└── Manual intervention required
```

## Process Lifecycle Analysis

### Normal Solve Command Flow

```
┌─────────────────────────────────────────────────────────────┐
│ solve.mjs starts                                             │
│ ├── Creates working directory in /tmp                        │
│ ├── Clones repository                                        │
│ ├── Spawns claude-code subprocess                            │
│ │   ├── Claude spawns MCP servers                            │
│ │   │   └── Playwright MCP spawns Chrome                     │
│ │   └── Claude performs actions                              │
│ ├── Claude exits                                             │
│ ├── Cleanup working directory                                │
│ └── solve.mjs exits                                          │
└─────────────────────────────────────────────────────────────┘
```

### Failure Scenarios Leading to Orphans

#### Scenario 1: Timeout Kill

```
┌─────────────────────────────────────────────────────────────┐
│ solve.mjs starts                                             │
│ ├── Spawns claude-code                                       │
│ │   ├── Claude spawns Chrome via Playwright                  │
│ │   │                                                        │
│ │   │   ⏰ TIMEOUT REACHED                                   │
│ │   │                                                        │
│ │   └── SIGKILL sent to claude-code                          │
│ │       ├── Chrome NOT killed (orphaned) ❌                  │
│ │       └── MCP servers NOT killed (orphaned) ❌             │
│ └── solve.mjs exits (cleanup may be incomplete)              │
│                                                              │
│ Result: Chrome processes continue running                    │
└─────────────────────────────────────────────────────────────┘
```

#### Scenario 2: Unexpected Termination

```
┌─────────────────────────────────────────────────────────────┐
│ solve.mjs starts                                             │
│ ├── Spawns claude-code                                       │
│ │   ├── Claude performing long operation                     │
│ │   │                                                        │
│ │   │   💥 OOM KILLER                                        │
│ │   │                                                        │
│ │   └── solve.mjs killed by OOM                              │
│                                                              │
│ Result:                                                      │
│ ├── Claude-code becomes orphan (adopted by init)             │
│ ├── All child processes orphaned                             │
│ └── /tmp directory NOT cleaned                               │
└─────────────────────────────────────────────────────────────┘
```

#### Scenario 3: Zombie Creation

```
┌─────────────────────────────────────────────────────────────┐
│ Parent process (solve.mjs)                                   │
│ ├── fork() creates child                                     │
│ │   └── Child performs work                                  │
│ │       └── Child exits                                      │
│ │           └── Child becomes zombie (waiting for wait())   │
│ │                                                            │
│ ├── Parent busy with other work                              │
│ │   └── Never calls wait() on child                          │
│ │                                                            │
│ Result: Zombie process in process table                      │
└─────────────────────────────────────────────────────────────┘
```

## /tmp Directory Growth Pattern

### Typical Contents After 7 Days

```
/tmp/
├── gh-issue-solver-1234567890123/     # 500MB (incomplete cleanup)
│   ├── .git/
│   ├── node_modules/                  # 300MB
│   └── ...
├── gh-issue-solver-1234567890124/     # 800MB (failed solve)
├── gh-issue-solver-1234567890125/     # 1.2GB (large repo)
├── playwright-*/                       # 100MB each (MCP temp files)
├── npm-*/                             # 50MB each (npm cache)
├── chromium-*/                        # 200MB each (browser profiles)
└── various temp files                 # 100MB+

Total: 10-50GB after a week of operation
```

## Server Reboot Timeline

### Current Manual Reboot Process

```
T-30min: Operator notices degradation
         └── Checks: df -h, htop, ps aux

T-15min: Operator decides to reboot
         └── Must wait for running solve commands

T-0:     Reboot initiated
         └── sudo reboot

T+1min:  Server coming back up
         └── System services starting

T+2min:  Server ready
         └── SSH accessible

T+5min:  Manual intervention required ❌
         └── Operator must: screen -S bot
         └── Then: hive-telegram-bot start

T+10min: Services restored
         └── Bot responding again
```

### Desired Auto-Recovery Timeline

```
T-30min: Automated monitoring detects degradation
         └── Alert sent (optional)

T-0:     Automated safe reboot (when no commands running)
         └── Graceful shutdown of services

T+1min:  Server coming back up
         └── System services starting

T+2min:  Server ready
         └── systemd starts hive-telegram-bot automatically ✅

T+3min:  Services restored automatically
         └── Bot responding, no manual intervention needed
```

## Key Metrics to Monitor

### Warning Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Disk /tmp usage | > 70% | > 90% |
| RAM usage | > 80% | > 95% |
| Process count | > 300 | > 500 |
| Load average | > 10 | > 20 |
| Zombie processes | > 5 | > 20 |

### Monitoring Commands

```bash
# Disk usage
df -h /tmp

# RAM usage
free -m

# Process count
ps aux | wc -l

# Zombie count
ps aux | grep -c Z

# Load average
uptime

# Orphaned node processes
pgrep -f "node" | wc -l

# Chrome processes (from Playwright)
pgrep -f "chrome" | wc -l
```
