# Multi-GitHub User Support Architecture

## Overview

This document outlines the architecture for supporting multiple GitHub user accounts in the hive-mind system. The solution uses Docker container isolation to provide secure, independent GitHub authentication contexts for each user.

## Problem Statement

The current hive-mind system operates with a single GitHub authentication context:

- One GitHub account per server instance
- All commands (`/solve`, `/hive`) run under the same GitHub identity
- No way to differentiate between Telegram users when making GitHub actions

### Why Not `--gh-token` or `--git-username`?

1. **Security Risk**: Passing tokens as command-line arguments exposes them in process lists
2. **Separation of Concerns**: The `solve` command should not manage authentication
3. **Complexity**: Token management at command level creates security and UX issues

## Proposed Solution: Docker Container Isolation

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Telegram Bot (Orchestrator)                   │
│                                                                      │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────────┐  │
│  │ User Registry  │  │  Container Pool  │  │  Auth Flow Manager  │  │
│  │ (TG→GH mapping)│  │  (Docker/K8s)    │  │  (Private Messages) │  │
│  └────────────────┘  └──────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
            ┌───────▼───┐ ┌─────▼─────┐ ┌───▼───────┐
            │ Container │ │ Container │ │ Container │
            │  User A   │ │  User B   │ │  User C   │
            │ ──────────│ │ ──────────│ │ ──────────│
            │ GH Token A│ │ GH Token B│ │ GH Token C│
            │ Git ID A  │ │ Git ID B  │ │ Git ID C  │
            └───────────┘ └───────────┘ └───────────┘
```

### Components

#### 1. User Registry

Maps Telegram user IDs to their GitHub authentication contexts.

```typescript
interface UserRegistration {
  telegramUserId: number;
  telegramUsername?: string;
  githubUsername: string;
  containerId?: string; // Active container ID
  registeredAt: Date;
  lastActiveAt: Date;
}
```

**Storage Options:**

- SQLite file (simple, local)
- Redis (for clustered deployments)
- Kubernetes ConfigMaps/Secrets (for K8s deployments)

#### 2. Container Pool Manager

Manages Docker/Kubernetes containers for isolated execution.

```typescript
interface ContainerConfig {
  userId: number; // Telegram user ID
  image: string; // Default: konard/hive-mind:latest
  volumeMounts: VolumeMount[]; // For persistent credentials
  resourceLimits: ResourceLimits; // CPU, memory limits
  ttl: number; // Time-to-live in seconds
}
```

**Container Lifecycle:**

1. **On-demand creation**: Container created when user sends command
2. **Warm pool**: Pre-warmed containers for faster response (optional)
3. **Auto-cleanup**: Containers removed after idle period
4. **Reuse**: Same container reused for subsequent commands from same user

#### 3. Authentication Flow Manager

Handles GitHub authentication through Telegram private messages.

```
User                    Bot                      GitHub
  │                      │                          │
  │ /register            │                          │
  │─────────────────────>│                          │
  │                      │                          │
  │ "Switching to DM..." │                          │
  │<─────────────────────│                          │
  │                      │                          │
  │ [Private Message]    │                          │
  │ "Click to auth"      │                          │
  │<─────────────────────│                          │
  │                      │                          │
  │ [User clicks link]   │                          │
  │──────────────────────┼─────────────────────────>│
  │                      │                          │
  │                      │  OAuth callback + token  │
  │                      │<─────────────────────────│
  │                      │                          │
  │ "Auth complete!"     │                          │
  │<─────────────────────│                          │
```

### Telegram Bot Changes

#### New Commands

```
/register    - Start GitHub authentication flow (initiates DM)
/whoami      - Show current GitHub identity
/accounts    - List registered accounts (admin only)
/unregister  - Remove GitHub account association
```

#### Modified Command Flow

```typescript
// Before executing /solve or /hive
async function executeUserCommand(ctx, command, args) {
  const telegramUserId = ctx.from.id;

  // 1. Check if user is registered
  const registration = await getUserRegistration(telegramUserId);
  if (!registration) {
    await ctx.reply('❌ You need to register a GitHub account first.\n' + 'Send /register to connect your GitHub account.');
    return;
  }

  // 2. Get or create user container
  const container = await getOrCreateContainer(registration);

  // 3. Execute command in container
  const result = await executeInContainer(container, command, args);

  return result;
}
```

### Docker Container Setup

Each user container is initialized using `gh-setup-git-identity`:

```dockerfile
# Base image with all tools
FROM konard/hive-mind:latest

# Entry script that sets up user identity
COPY docker-user-init.sh /usr/local/bin/
ENTRYPOINT ["/usr/local/bin/docker-user-init.sh"]
```

```bash
#!/bin/bash
# docker-user-init.sh

# Restore GitHub credentials from mounted secret
if [ -f /secrets/gh-token ]; then
  echo "$(cat /secrets/gh-token)" | gh auth login --with-token
fi

# Setup git identity from authenticated GitHub account
gh-setup-git-identity

# Execute the actual command
exec "$@"
```

### Security Considerations

1. **Token Isolation**: Each container has access only to its own GitHub token
2. **No Token in CLI**: Tokens are never passed as command-line arguments
3. **Encrypted Storage**: User registry encrypts sensitive data at rest
4. **Container Sandboxing**: Containers have limited network and filesystem access
5. **Token Rotation**: Support for periodic token refresh/rotation
6. **Audit Logging**: All actions are logged with user attribution

### Deployment Options

#### Option A: Single-Server Docker

```yaml
# docker-compose.multi-user.yml
version: '3.8'

services:
  telegram-bot:
    image: konard/hive-mind:latest
    command: hive-telegram-bot --multi-user
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - MULTI_USER_MODE=true
      - USER_REGISTRY_PATH=/data/users.db
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/data
```

#### Option B: Kubernetes Deployment

```yaml
# helm/values-multi-user.yaml
multiUser:
  enabled: true
  registry:
    type: configmap # or 'secret' for production
  containers:
    pool:
      warmSize: 2
      maxSize: 10
    resources:
      cpu: 1
      memory: 2Gi
    ttl: 3600 # 1 hour
```

### Implementation Phases

#### Phase 1: Foundation (MVP)

- [ ] User registry with simple file-based storage
- [ ] `/register` command with manual token input (via DM)
- [ ] Container creation per command execution
- [ ] Basic `/whoami` command

#### Phase 2: OAuth Integration

- [ ] GitHub OAuth flow for seamless authentication
- [ ] OAuth callback server in bot
- [ ] Token refresh mechanism

#### Phase 3: Container Optimization

- [ ] Container pooling for faster startup
- [ ] Container reuse between commands
- [ ] Resource limits and quotas per user

#### Phase 4: Enterprise Features

- [ ] Multi-organization support
- [ ] Role-based access control
- [ ] Audit logging and compliance
- [ ] Admin dashboard

### Related Projects

- [link-foundation/start](https://github.com/link-foundation/start) - Command wrapper with Docker isolation support
- [link-foundation/gh-setup-git-identity](https://github.com/link-foundation/gh-setup-git-identity) - Automated git identity setup from GitHub account

### Migration Path

For existing single-user deployments:

1. Enable multi-user mode in configuration
2. Existing (single) GitHub account becomes "default" for unregistered users
3. Users can optionally register their own accounts
4. Gradually transition to per-user containers

### Open Questions

1. **Private Repo Access**: How to handle cases where user A wants to solve issues in a repo that user B has access to?
   - _Proposed_: Commands always use the executing user's credentials

2. **Rate Limiting**: How to prevent one user from exhausting shared resources?
   - _Proposed_: Per-user quotas on container creation and command execution

3. **Persistence**: Should container state persist across restarts?
   - _Proposed_: Ephemeral containers, with optional volume mounts for work-in-progress

4. **Team Accounts**: Support for shared GitHub accounts across multiple Telegram users?
   - _Proposed_: Phase 4 feature, requires additional role mapping

## References

- Issue #977: https://github.com/link-assistant/hive-mind/issues/977
- Issue #446: https://github.com/link-assistant/hive-mind/issues/446
- Docker docs: https://docs.docker.com/engine/api/
- GitHub OAuth: https://docs.github.com/en/developers/apps/building-oauth-apps
