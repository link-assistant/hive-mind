# Hive Mind: Comprehensive Project Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Core Features](#core-features)
4. [Technology Stack](#technology-stack)
5. [Installation Guide](#installation-guide)
6. [Configuration & Authentication](#configuration--authentication)
7. [Usage Guide](#usage-guide)
8. [Project Structure](#project-structure)
9. [Security Considerations](#security-considerations)
10. [Development & Contributing](#development--contributing)
11. [Troubleshooting](#troubleshooting)

---

## Project Overview

### What is Hive Mind?

**Hive Mind** is an AI orchestration platform that coordinates multiple AI agents to autonomously solve GitHub issues, manage code repositories, and automate software development workflows. The system operates as "the AI that controls AIs" - a master coordinator managing a swarm of specialized AI workers.

### Repository Information
- **GitHub**: [Metanoiabot/hive-mind](https://github.com/Metanoiabot/hive-mind)
- **Original Fork From**: [konard/hive-mind](https://github.com/konard/hive-mind) (via link-assistant organization)
- **Primary Language**: JavaScript (Node.js/Bun)
- **License**: Unlicense (Public Domain)
- **Supported Platforms**: Ubuntu 24.04 (recommended), containerized environments

### Key Capabilities

1. **Autonomous Issue Resolution**: Automatically analyzes and solves GitHub issues
2. **Multi-Repository Orchestration**: Monitors and manages multiple repositories concurrently
3. **Auto-Forking**: Automatically forks public repositories when write access unavailable
4. **Code Review Automation**: Multi-agent collaborative review processes
5. **Human-in-the-Loop**: Maintains human decision authority at integration points
6. **Remote Management**: Telegram bot interface for remote command execution

### Value Proposition

Hive Mind transforms software development by:
- Reducing manual issue triage and resolution time
- Enabling 24/7 autonomous development workflows
- Scaling development capacity through AI orchestration
- Maintaining code quality through multi-agent review consensus
- Preserving human oversight through draft PR workflows

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Hive Mind Orchestration Layer               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐         ┌──────────────────┐             │
│  │   Human Input    │         │  GitHub Events   │             │
│  │  • Telegram Bot  │────┐    │  • Issue Open    │────┐        │
│  │  • CLI Commands  │    │    │  • PR Comments   │    │        │
│  └──────────────────┘    │    └──────────────────┘    │        │
│                           ▼                             ▼        │
│                  ┌────────────────────────────────────────┐     │
│                  │     Orchestrator (hive.mjs)            │     │
│                  │  • Repository monitoring               │     │
│                  │  • Task queue management               │     │
│                  │  • Concurrency control                 │     │
│                  └────────────────────────────────────────┘     │
│                                    │                             │
│          ┌─────────────────────────┼─────────────────────────┐  │
│          ▼                         ▼                         ▼  │
│  ┌──────────────┐         ┌──────────────┐        ┌──────────────┐
│  │ Issue Solver │         │ Code Reviewer │        │ PR Manager   │
│  │ (solve.mjs)  │         │ (review.mjs)  │        │              │
│  └──────────────┘         └──────────────┘        └──────────────┘
│          │                         │                         │  │
│          │                         │                         │  │
│          ▼                         ▼                         ▼  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              AI Agent Execution Layer                      │ │
│  │                                                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │ │
│  │  │  Claude  │  │ OpenCode │  │  Codex   │  │ Custom   │ │ │
│  │  │  Agent   │  │  Agent   │  │  Agent   │  │  Agent   │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                    │                             │
│                                    ▼                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │            Repository Integration Layer                     │ │
│  │  • Git operations (clone, commit, push)                    │ │
│  │  • GitHub API (issues, PRs, comments)                      │ │
│  │  • Auto-fork management                                    │ │
│  │  • Branch protection handling                              │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

#### Issue Resolution Workflow

```
GitHub Issue Created
        │
        ▼
Hive Mind Detects (Monitoring)
        │
        ▼
Check Repository Access
        │
        ├─── Has Write Access ────► Work Directly
        │
        └─── No Access ──────────► Auto-Fork
                                      │
                                      ▼
                              Create Draft PR
                                      │
                                      ▼
                              Launch AI Agent
                                      │
                              ┌───────┴───────┐
                              │               │
                         Analyze Issue    Read Code
                              │               │
                              └───────┬───────┘
                                      │
                                      ▼
                              Implement Solution
                                      │
                                      ▼
                              Write Tests
                                      │
                                      ▼
                              Commit Changes
                                      │
                                      ▼
                              Update PR Description
                                      │
                                      ▼
                              Mark PR Ready
                                      │
                                      ▼
                              Notify Human Reviewer
                                      │
                                      ▼
                        Human Reviews & Merges
```

### Data Flow

1. **Input**: GitHub events, Telegram commands, CLI invocations
2. **Processing**: Orchestrator assigns tasks to AI agents
3. **Execution**: Agents analyze, code, test, and commit
4. **Output**: Pull requests, comments, logs
5. **Feedback**: Human review and approval loop

---

## Core Features

### 1. Autonomous Issue Solving (`solve.mjs`)

**Capabilities:**
- Automatic issue analysis and understanding
- Context gathering from codebase and documentation
- Solution implementation with tests
- Commit message generation following repository conventions
- Pull request creation with detailed descriptions

**Key Parameters:**
```bash
solve <issue-url> [options]
  --auto-fork          # Automatically fork if no write access
  --model <name>       # AI model selection (opus/sonnet/haiku)
  --concurrency <n>    # Number of parallel operations
  --draft              # Keep PR in draft state
  --no-push            # Local changes only (no push)
```

**Example:**
```bash
hive-mind solve https://github.com/owner/repo/issues/123 \
  --auto-fork \
  --model opus
```

### 2. Multi-Repository Orchestration (`hive.mjs`)

**Capabilities:**
- Monitor multiple repositories simultaneously
- Configurable polling intervals
- Concurrent issue processing
- Resource management and load balancing
- Session resumption after token limit interruptions

**Key Parameters:**
```bash
hive <repo-url> [options]
  --all-issues         # Process all open issues
  --labels <list>      # Filter by labels (comma-separated)
  --concurrency <n>    # Max parallel workers (default: 3)
  --interval <ms>      # Polling interval (default: 60000)
  --max-tokens <n>     # Token budget per agent
```

**Example:**
```bash
hive-mind hive https://github.com/owner/repo \
  --all-issues \
  --labels "bug,help wanted" \
  --concurrency 5
```

### 3. Automated Code Review (`review.mjs`)

**Capabilities:**
- Multi-agent review consensus
- Automated feedback generation
- Best practice enforcement
- Security vulnerability detection
- Style consistency checking

**Review Process:**
1. Multiple AI agents independently review PR
2. Consensus building across agent feedback
3. Consolidated review comment generation
4. Human-readable improvement suggestions

**Status:** Alpha - Under active development

### 4. Telegram Bot Interface

**Purpose:** Remote command execution and monitoring

**Setup:**
- Bot Username: `@SwarmMindBot` (example)
- Requires admin status in group chats
- Secure token-based authentication

**Available Commands:**
- `/solve <issue-url>` - Trigger issue resolution
- `/hive <repo-url>` - Start repository monitoring
- `/status` - Check active workers and queue
- `/help` - Display command reference
- `/stop <task-id>` - Terminate running task

**Security Notes:**
- Only works in authorized group chats
- Requires proper authentication setup
- Logs all commands for audit trail

### 5. Session Management

**Features:**
- Automatic session state preservation
- Token limit detection and graceful pausing
- Resume capability from exact breakpoint
- Progress checkpointing

**Use Case:**
Long-running tasks that exceed AI model context limits can automatically pause and resume with full context restoration.

---

## Technology Stack

### Core Technologies

**Runtime Environment:**
- **Bun** (recommended) - Fast JavaScript runtime
- **Node.js** - Alternative runtime support
- Platform: Ubuntu 24.04 LTS (primary target)

**AI Model Integrations:**

| Provider | Models | Use Case |
|----------|--------|----------|
| **Anthropic Claude** | Sonnet, Opus | General development, architecture |
| **OpenCode** | Grok Code Fast 1, GPT-4o | Fast prototyping |
| **Codex** | GPT-5, O3 | Advanced reasoning |

**Infrastructure:**
- **Docker** - Containerized isolated environments
- **Kubernetes** - Production orchestration via Helm charts
- **GitHub API** - Repository and issue management
- **Git** - Version control operations

**Programming Languages:**
- JavaScript/TypeScript (primary)
- Shell scripting (deployment automation)

### External Dependencies

**Required Services:**
- GitHub API access (authenticated)
- Claude API access (via claude-profiles)
- Optional: OpenAI, Groq, or other LLM providers

**System Requirements:**
- **Minimum**: 1 CPU core, 1GB RAM, 2GB+ swap, 50GB disk
- **Recommended**: 4+ CPU cores, 8GB+ RAM, 100GB+ disk

---

## Installation Guide

### Method 1: Global Package Installation (Quickest)

#### Using Bun (Recommended)
```bash
bun install -g @deep-assistant/hive-mind
```

#### Using npm
```bash
npm install -g @deep-assistant/hive-mind
```

**Verify Installation:**
```bash
hive-mind --version
```

### Method 2: Ubuntu 24.04 Server Installation

**Prerequisites:**
- Fresh Ubuntu 24.04 installation
- Root or sudo access
- Internet connection

**Automated Installation:**
```bash
curl -fsSL -o- https://github.com/deep-assistant/hive-mind/raw/refs/heads/main/scripts/ubuntu-24-server-install.sh | bash
```

**What This Installs:**
- Bun runtime
- Hive Mind package
- GitHub CLI (`gh`)
- Required system dependencies
- Initial configuration templates

**Post-Installation:**
```bash
# Verify installation
hive-mind --version

# Check GitHub authentication
gh auth status

# Check Claude authentication
claude-profiles list
```

### Method 3: Docker Container (Isolated)

**Why Docker?**
- Complete isolation from host system
- Prevents accidental system modifications
- Easy cleanup and redeployment
- Recommended for production use

**Build and Run:**
```bash
# Clone repository
git clone https://github.com/Metanoiabot/hive-mind.git
cd hive-mind

# Build Docker image
docker build -t hive-mind:latest .

# Run container
docker run -it \
  -v $(pwd)/data:/app/data \
  -e GITHUB_TOKEN=$GITHUB_TOKEN \
  hive-mind:latest solve <issue-url>
```

**Docker Compose Setup:**
```yaml
version: '3.8'
services:
  hive-mind:
    build: .
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    environment:
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - CLAUDE_API_KEY=${CLAUDE_API_KEY}
    restart: unless-stopped
```

### Method 4: Kubernetes Deployment (Production)

**Using Helm Charts:**
```bash
# Add Helm repository (if available)
helm repo add hive-mind https://charts.hive-mind.dev

# Install
helm install hive-mind hive-mind/hive-mind \
  --set github.token=$GITHUB_TOKEN \
  --set claude.apiKey=$CLAUDE_API_KEY \
  --set concurrency=5
```

**Custom Configuration:**
Create `values.yaml`:
```yaml
replicaCount: 3

image:
  repository: hive-mind
  tag: latest

resources:
  limits:
    cpu: 2000m
    memory: 4Gi
  requests:
    cpu: 500m
    memory: 1Gi

config:
  concurrency: 5
  pollingInterval: 60000
  maxTokens: 200000
```

Apply:
```bash
helm install hive-mind hive-mind/hive-mind -f values.yaml
```

---

## Configuration & Authentication

### GitHub Authentication

**Initial Setup:**
```bash
gh auth login
```

**Follow Prompts:**
1. Select GitHub.com
2. Choose HTTPS or SSH
3. Authenticate via browser or token
4. Select default git protocol

**Verify:**
```bash
gh auth status
```

**Required Permissions:**
- `repo` - Full repository access
- `workflow` - GitHub Actions management
- `admin:org` - Organization management (for forks)

### Claude Authentication

**Server-Based Setup:**
```bash
claude-profiles
```

**Configuration:**
1. Create new profile
2. Enter organization ID
3. Provide API key or authenticate via browser
4. Set as default profile

**Verify:**
```bash
claude-profiles list
```

### OpenAI-Compatible Endpoints

**Environment Variables:**
```bash
export HIVE_MIND_OPENAI_ENDPOINT="https://api.openai.com/v1"
export HIVE_MIND_OPENAI_API_KEY="sk-..."
```

**Command-Line Flags:**
```bash
hive-mind solve <issue-url> \
  --openai-endpoint "https://api.openai.com/v1" \
  --openai-api-key "sk-..."
```

**Supported Providers:**
- OpenAI
- Azure OpenAI
- Groq
- Together AI
- Any OpenAI Chat Completions-compatible API

### Telegram Bot Configuration

**Setup Process:**
1. Create bot via [@BotFather](https://t.me/BotFather)
2. Obtain bot token
3. Configure Hive Mind:

```bash
export TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
export TELEGRAM_CHAT_ID="-1001234567890"
```

4. Start bot:
```bash
hive-mind telegram-bot
```

**Security:**
- Store tokens securely (use secrets management)
- Restrict bot to authorized group chats
- Enable admin-only mode
- Audit command logs regularly

---

## Usage Guide

### Basic Workflows

#### Solve Single Issue

```bash
# Basic issue solving
hive-mind solve https://github.com/owner/repo/issues/123

# With auto-fork (for public repos without write access)
hive-mind solve https://github.com/owner/repo/issues/123 --auto-fork

# Specify AI model
hive-mind solve https://github.com/owner/repo/issues/123 --model opus

# Keep PR in draft state
hive-mind solve https://github.com/owner/repo/issues/123 --draft
```

#### Monitor Repository

```bash
# Monitor all issues
hive-mind hive https://github.com/owner/repo --all-issues

# Filter by labels
hive-mind hive https://github.com/owner/repo \
  --labels "bug,enhancement" \
  --all-issues

# Adjust concurrency
hive-mind hive https://github.com/owner/repo \
  --all-issues \
  --concurrency 10
```

#### Code Review

```bash
# Review specific PR
hive-mind review https://github.com/owner/repo/pull/456

# Multi-agent consensus review
hive-mind review https://github.com/owner/repo/pull/456 \
  --agents 3 \
  --consensus-threshold 0.8
```

### Advanced Usage

#### Custom Workflows

**Batch Processing:**
```bash
# Process multiple issues from file
cat issues.txt | while read issue_url; do
  hive-mind solve "$issue_url" --auto-fork --model sonnet
done
```

**Monitoring Script:**
```bash
#!/bin/bash
# monitor_repos.sh

REPOS=(
  "https://github.com/org/repo1"
  "https://github.com/org/repo2"
  "https://github.com/org/repo3"
)

for repo in "${REPOS[@]}"; do
  hive-mind hive "$repo" \
    --all-issues \
    --labels "good first issue" \
    --concurrency 3 &
done

wait
```

#### Integration with CI/CD

**GitHub Actions Example:**
```yaml
name: Hive Mind Auto-Solve

on:
  issues:
    types: [opened, labeled]

jobs:
  auto-solve:
    runs-on: ubuntu-latest
    steps:
      - name: Install Hive Mind
        run: bun install -g @deep-assistant/hive-mind

      - name: Solve Issue
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
        run: |
          hive-mind solve ${{ github.event.issue.html_url }} \
            --model sonnet \
            --draft
```

### Best Practices

#### Resource Management

1. **Concurrency Limits**: Start with 3-5 concurrent workers, scale based on system resources
2. **Polling Intervals**: Use 60-120 second intervals to avoid API rate limits
3. **Token Budgets**: Set appropriate limits to prevent excessive API costs

#### Quality Assurance

1. **Draft PRs**: Always create draft PRs initially for human review
2. **Test Coverage**: Ensure AI agents include tests in solutions
3. **Review Process**: Use multi-agent review for critical changes
4. **Monitoring**: Regularly check logs for errors and quality issues

#### Security

1. **Isolated Environments**: Use Docker/Kubernetes for production
2. **Credential Management**: Store tokens in secure vaults (not environment variables)
3. **Access Control**: Limit repository permissions to necessary scope
4. **Audit Logging**: Enable comprehensive logging of all operations

---

## Project Structure

```
hive-mind/
│
├── src/                          # Source code
│   ├── solve.mjs                 # Issue solver
│   ├── hive.mjs                  # Orchestrator
│   ├── review.mjs                # Code reviewer
│   ├── telegram-bot.mjs          # Telegram interface
│   │
│   ├── agents/                   # AI agent implementations
│   │   ├── claude-agent.mjs
│   │   ├── opencode-agent.mjs
│   │   └── codex-agent.mjs
│   │
│   ├── github/                   # GitHub API integration
│   │   ├── api-client.mjs
│   │   ├── fork-manager.mjs
│   │   └── pr-manager.mjs
│   │
│   ├── git/                      # Git operations
│   │   ├── clone.mjs
│   │   ├── commit.mjs
│   │   └── push.mjs
│   │
│   └── utils/                    # Utilities
│       ├── logger.mjs
│       ├── config.mjs
│       └── session.mjs
│
├── scripts/                      # Deployment scripts
│   ├── ubuntu-24-server-install.sh
│   ├── docker-solve.sh
│   └── cleanup-test-repos.mjs
│
├── .github/workflows/            # CI/CD workflows
│   ├── test.yml
│   ├── release.yml
│   └── auto-solve.yml
│
├── tests/                        # Test suite
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/                         # Documentation
│   ├── architecture.md
│   ├── api-reference.md
│   └── deployment-guide.md
│
├── data/                         # Runtime data
│   ├── case-studies/
│   └── sessions/
│
├── experiments/                  # Experimental features
│
├── coolify/                      # Coolify deployment config
│
├── Dockerfile                    # Container definition
├── docker-compose.yml            # Compose configuration
├── package.json                  # Node.js package config
├── README.md                     # Project readme
├── CLAUDE.md                     # Claude-specific instructions
├── .env.example                  # Environment template
└── .lenv.example                 # Local environment template
```

### Key File Descriptions

| File | Purpose |
|------|---------|
| `src/solve.mjs` | Single issue resolution logic |
| `src/hive.mjs` | Multi-repository orchestration |
| `src/review.mjs` | Automated code review system |
| `src/telegram-bot.mjs` | Telegram bot command handler |
| `scripts/ubuntu-24-server-install.sh` | Automated server setup |
| `docker-compose.yml` | Container orchestration config |
| `CLAUDE.md` | Instructions for Claude agents |

---

## Security Considerations

### ⚠️ Critical Security Warnings

**This software is UNSAFE to run on developer machines.**

#### Identified Risks

1. **Token Exposure**
   - Claude API keys
   - GitHub personal access tokens
   - Third-party API credentials
   - Risk: Credential leakage through logs or errors

2. **System Damage**
   - Autonomous code execution
   - File system modifications
   - Network operations
   - Risk: Unintended system changes requiring reinstallation

3. **Space Leakage**
   - Repository cloning consumes disk space
   - Log files grow unbounded
   - Temporary files not cleaned
   - Risk: Disk exhaustion on internet-connected systems

4. **Code Injection**
   - AI-generated code execution
   - Untrusted issue content processing
   - Risk: Malicious code injection through crafted issues

### Recommended Security Measures

#### 1. Isolation

**Required:**
- Dedicated Ubuntu 24.04 virtual machine
- No shared resources with production systems
- Network segmentation

**Strongly Recommended:**
- Docker containerization
- Kubernetes namespace isolation
- Read-only file system mounts where possible

#### 2. Credential Management

**Best Practices:**
```bash
# Use dedicated service accounts
# GitHub: Create bot account with minimal permissions
# Claude: Use organization-specific API keys

# Rotate credentials regularly
# Set expiration dates on tokens
# Monitor usage for anomalies
```

**Secret Storage:**
- Use Kubernetes Secrets
- HashiCorp Vault
- AWS Secrets Manager
- Never commit credentials to git

#### 3. Resource Limits

**Docker Example:**
```yaml
services:
  hive-mind:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '0.5'
          memory: 1G
```

**Kubernetes Example:**
```yaml
resources:
  limits:
    cpu: "2000m"
    memory: "4Gi"
    ephemeral-storage: "10Gi"
  requests:
    cpu: "500m"
    memory: "1Gi"
```

#### 4. Network Security

- Outbound-only internet access
- Block unnecessary ports
- Use firewall rules to restrict access
- Enable audit logging for all network calls

#### 5. Monitoring & Auditing

**Log Everything:**
```bash
# Enable comprehensive logging
export HIVE_MIND_LOG_LEVEL=debug

# Centralized log aggregation
# Send logs to SIEM or log management system
```

**Alert on:**
- Unexpected API usage spikes
- Failed authentication attempts
- Unusual repository access patterns
- Resource limit violations

---

## Development & Contributing

### Development Setup

**Clone Repository:**
```bash
git clone https://github.com/Metanoiabot/hive-mind.git
cd hive-mind
```

**Install Dependencies:**
```bash
# Using Bun
bun install

# Using npm
npm install
```

**Run Tests:**
```bash
bun test
```

**Local Development:**
```bash
# Run in development mode
bun run dev

# Test solve locally (no push)
bun run src/solve.mjs <issue-url> --no-push
```

### Contributing Guidelines

**Workflow:**
1. Fork repository
2. Create feature branch: `git checkout -b feature/your-feature`
3. Make changes with tests
4. Run linter: `bun run lint`
5. Run tests: `bun test`
6. Commit with conventional commits format
7. Push and create pull request

**Commit Message Format:**
```
type(scope): brief description

Detailed description of changes

Fixes #123
```

**Types:** feat, fix, docs, style, refactor, test, chore

### Testing Strategy

**Test Categories:**
1. **Unit Tests**: Individual function logic
2. **Integration Tests**: GitHub API interactions
3. **E2E Tests**: Full workflow validation
4. **Smoke Tests**: Basic functionality checks

**Running Tests:**
```bash
# All tests
bun test

# Specific suite
bun test tests/unit/

# With coverage
bun test --coverage
```

---

## Troubleshooting

### Common Issues

#### 1. Authentication Failures

**Symptoms:** "Authentication failed" or 401/403 errors

**Solutions:**
```bash
# Re-authenticate GitHub
gh auth logout
gh auth login

# Verify permissions
gh auth status

# Check token scopes
# Ensure 'repo', 'workflow' scopes enabled
```

#### 2. Fork Creation Errors

**Symptoms:** "Failed to fork repository" or permission errors

**Solutions:**
- Verify GitHub token has `admin:org` scope
- Check organization fork policies
- Ensure repository is public (for auto-fork)
- Manually fork and retry with forked URL

#### 3. High API Costs

**Symptoms:** Unexpected billing from Claude/OpenAI

**Solutions:**
- Set concurrency limits: `--concurrency 3`
- Use cheaper models: `--model sonnet` or `--model haiku`
- Implement token budgets: `--max-tokens 50000`
- Monitor usage in provider dashboard

#### 4. Disk Space Exhaustion

**Symptoms:** "No space left on device" errors

**Solutions:**
```bash
# Clean up temporary repositories
rm -rf /tmp/hive-mind-*

# Remove old logs
find logs/ -name "*.log" -mtime +7 -delete

# Prune Docker resources
docker system prune -af
```

#### 5. Session State Loss

**Symptoms:** Agent restarts from beginning after interruption

**Solutions:**
- Enable session persistence in config
- Check disk space for session storage
- Verify `data/sessions/` directory permissions

### Debug Mode

**Enable Detailed Logging:**
```bash
export HIVE_MIND_LOG_LEVEL=debug
export HIVE_MIND_LOG_FILE=logs/hive-mind-debug.log

hive-mind solve <issue-url>
```

**Log Analysis:**
```bash
# Search for errors
grep ERROR logs/hive-mind-debug.log

# View API calls
grep "API Request" logs/hive-mind-debug.log

# Check agent decisions
grep "Agent Decision" logs/hive-mind-debug.log
```

### Getting Help

1. **GitHub Issues**: [Report bugs](https://github.com/Metanoiabot/hive-mind/issues)
2. **Discussions**: [Ask questions](https://github.com/Metanoiabot/hive-mind/discussions)
3. **Documentation**: Check README.md and docs/ directory
4. **Community**: Join Discord/Slack (if available)

### Maintenance Commands

**Clean Screen Sessions:**
```bash
screen -ls | awk '/(Detached|Attached)/{print $1}' | while read s; do
  screen -S "$s" -X quit
done
```

**Reset Temp Directory:**
```bash
sudo rm -rf /tmp/*
sudo mkdir -p /tmp
sudo chmod 1777 /tmp
```

**Update Hive Mind:**
```bash
# Global installation
bun update -g @deep-assistant/hive-mind

# Or from source
cd hive-mind
git pull
bun install
```

---

## Appendix: Configuration Reference

### Environment Variables

```bash
# GitHub Authentication
GITHUB_TOKEN="ghp_..."              # Personal access token
GITHUB_API_URL="https://api.github.com"

# Claude Configuration
CLAUDE_API_KEY="sk-ant-..."         # Claude API key (if not using profiles)

# OpenAI-Compatible Endpoints
HIVE_MIND_OPENAI_ENDPOINT="https://api.openai.com/v1"
HIVE_MIND_OPENAI_API_KEY="sk-..."

# Telegram Bot
TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
TELEGRAM_CHAT_ID="-1001234567890"

# Logging
HIVE_MIND_LOG_LEVEL="info"         # debug, info, warn, error
HIVE_MIND_LOG_FILE="logs/hive.log"

# Performance
HIVE_MIND_CONCURRENCY="3"          # Max parallel workers
HIVE_MIND_POLLING_INTERVAL="60000" # Milliseconds
HIVE_MIND_MAX_TOKENS="200000"      # Per-agent token budget
```

### Command Reference

```bash
# Issue Solving
hive-mind solve <issue-url> [options]
  --auto-fork              # Auto-fork if no write access
  --model <name>           # opus, sonnet, haiku
  --draft                  # Keep PR as draft
  --no-push                # Local only (testing)
  --concurrency <n>        # Parallel operations
  --max-tokens <n>         # Token budget

# Repository Monitoring
hive-mind hive <repo-url> [options]
  --all-issues             # Process all open issues
  --labels <list>          # Filter by labels
  --concurrency <n>        # Max parallel workers
  --interval <ms>          # Polling interval
  --max-tokens <n>         # Token budget per agent

# Code Review
hive-mind review <pr-url> [options]
  --agents <n>             # Number of review agents
  --consensus-threshold <f># Agreement threshold (0-1)

# Telegram Bot
hive-mind telegram-bot [options]
  --token <token>          # Bot token
  --chat-id <id>           # Authorized chat ID

# Utilities
hive-mind --version        # Show version
hive-mind --help           # Show help
```

---

**Document Version**: 1.0
**Last Updated**: 2025-12-06
**Author**: AI Documentation Generator
**Repository**: [Metanoiabot/hive-mind](https://github.com/Metanoiabot/hive-mind)
