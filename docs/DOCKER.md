# Docker Support for Hive Mind (languages: en • [zh](DOCKER.zh.md) • [hi](DOCKER.hi.md) • [ru](DOCKER.ru.md))

This document explains how to run Hive Mind in Docker containers.

## Quick Start

### Option 1: Using Pre-built Image from Docker Hub (Recommended)

```bash
# Pull the latest image
docker pull konard/hive-mind:latest

# Create persistent host directories used by the current Docker workflow
mkdir -p /root/.hive-mind/claude /root/.hive-mind/codex /root/.hive-mind/gh
touch -a /root/.hive-mind/claude.json

# Run the container in detached mode with the same mounts we use locally
docker run -dit --user sandbox --name hive-mind --restart unless-stopped \
  -v /root/.hive-mind/claude:/workspace/.claude \
  -v /root/.hive-mind/codex:/workspace/.codex \
  -v /root/.hive-mind/claude.json:/workspace/.claude.json \
  -v /root/.hive-mind/gh:/workspace/.config/gh \
  konard/hive-mind:latest bash -l -c 'bash /workspace/start-bot.sh'

# Open a shell in the running container
docker exec -it hive-mind bash

# Inside the container, authenticate with GitHub
gh auth login -h github.com -s repo,workflow,user,read:org,gist

# Authenticate with Claude
claude

# Install or update Codex CLI
bun install -g @openai/codex@latest

# Log in to Codex using the current device auth flow
codex login --device-auth

# Verify Codex after login succeeds with "Successfully logged in"
codex exec --model gpt-5.4-mini "hi"

# Verify Playwright MCP registration in both CLIs
claude mcp list | grep playwright
codex mcp list | grep playwright

# Exit the shell when setup is complete
exit
```

### Option 2: Building Locally

```bash
# Build the production image
docker build -t hive-mind:local .

# Run the image
docker run -it hive-mind:local
```

### Option 3: Development Mode (Gitpod-style)

For development purposes, the legacy `Dockerfile` provides a Gitpod-compatible environment:

```bash
# Build the development image
docker build -t hive-mind-dev .

# Run with credential mounts
docker run --rm -it \
    -v ~/.config/gh:/workspace/.persisted-configs/gh:ro \
    -v ~/.local/share/claude-profiles:/workspace/.persisted-configs/claude:ro \
    -v ~/.config/claude-code:/workspace/.persisted-configs/claude-code:ro \
    -v "$(pwd)/output:/workspace/output" \
    hive-mind-dev
```

## Authentication

The production Docker image (`Dockerfile`) uses Ubuntu 24.04 and the official installation script. **IMPORTANT:** Authentication is performed **inside the container AFTER** the Docker image is fully installed and running.

**Why Authentication Happens After Installation:**

- ✅ Avoids Docker build timeouts caused by interactive prompts
- ✅ Prevents build failures in CI/CD pipelines
- ✅ Allows the installation script to complete successfully
- ✅ Supports automated Docker image builds

### GitHub Authentication

```bash
# Inside the container, AFTER it's running
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

**Note:** The installation script intentionally does NOT call `gh auth login` during the build process. This is by design to support Docker builds without timeouts.

### Claude Authentication

```bash
# Inside the container, AFTER it's running
claude
```

### Codex Authentication

Install or update Codex CLI inside the running container:

```bash
bun install -g @openai/codex@latest
```

Log in with the device auth flow we currently use:

```bash
codex login --device-auth
```

The command should finish with:

```text
Successfully logged in
```

Then run the current smoke test:

```bash
codex exec --model gpt-5.4-mini "hi"
```

This approach allows:

- ✅ Multiple Docker instances with different GitHub accounts
- ✅ Multiple Docker instances with different Claude subscriptions
- ✅ Persistent Codex authentication and session data when `/workspace/.codex` is mounted
- ✅ No credential leakage between containers
- ✅ Each container has its own isolated authentication
- ✅ Successful Docker builds without interactive authentication

## Playwright MCP State in Docker

The image build now registers Playwright MCP for both Claude and Codex:

- `claude mcp add playwright -s user -- ...`
- `codex mcp add playwright -- ...`

The CI workflow also builds the Docker image and verifies that both `claude mcp list` and `codex mcp list` contain `playwright`.

If you still reproduce `codex mcp list` showing `No MCP servers configured yet` in a running container, the most likely root cause is a mounted `/workspace/.codex` directory from the host. In this image `HOME=/workspace`, so mounting `/workspace/.codex` replaces the image-baked Codex config, including any preconfigured MCP entries.

That means:

- the published image can be correct,
- the runtime container can still show Codex as unconfigured,
- and the difference is caused by persisted host state overriding the container defaults.

To confirm that quickly, compare these two cases:

```bash
# Fresh container without host-mounted Codex state
docker run --rm -it konard/hive-mind:latest bash -lc 'codex mcp list'

# Container with persisted Codex state from host
docker run --rm -it \
  -v /root/.hive-mind/codex:/workspace/.codex \
  konard/hive-mind:latest \
  bash -lc 'codex mcp list'
```

If the first command shows `playwright` and the second does not, the host-mounted Codex directory is the source of the mismatch.

## Prerequisites

1. **Docker:** Install Docker Desktop or Docker Engine (version 20.10 or higher)
2. **Internet Connection:** Required for pulling images and authentication

## Directory Structure

```
.
├── Dockerfile                    # Production image using Ubuntu 24.04
├── experiments/
│   └── solve-dockerize/
│       └── Dockerfile            # Legacy Gitpod-compatible image (archived)
├── scripts/
│   └── ubuntu-24-server-install.sh  # Installation script used by Dockerfile
└── docs/
    └── DOCKER.md                 # This file
```

## Advanced Usage

### Running with Persistent Storage

To persist authentication and work between container restarts, mount the actual per-tool directories instead of a generic `/workspace` volume. In our Docker images `HOME=/workspace`, so Codex stores its data in `/workspace/.codex`.

```bash
# Host directories used by the current local Docker workflow
mkdir -p /root/.hive-mind/claude /root/.hive-mind/codex /root/.hive-mind/gh
touch -a /root/.hive-mind/claude.json

# Run with persistent mounts
docker run -dit --user sandbox --name hive-mind --restart unless-stopped \
  -v /root/.hive-mind/claude:/workspace/.claude \
  -v /root/.hive-mind/codex:/workspace/.codex \
  -v /root/.hive-mind/claude.json:/workspace/.claude.json \
  -v /root/.hive-mind/gh:/workspace/.config/gh \
  konard/hive-mind:latest bash -l -c 'bash /workspace/start-bot.sh'

# Fix ownership after the container starts
SANDBOX_UID=$(docker exec hive-mind id -u sandbox)
chown -R $SANDBOX_UID:$SANDBOX_UID /root/.hive-mind/claude /root/.hive-mind/codex /root/.hive-mind/gh
chown $SANDBOX_UID:$SANDBOX_UID /root/.hive-mind/claude.json
```

The mounted Codex directory keeps the files we rely on:

- `/workspace/.codex/auth.json`
- `/workspace/.codex/config.toml`
- `/workspace/.codex/sessions/`

Because this mount fully overrides the image's `/workspace/.codex` directory, it can also preserve an older `config.toml` that does not include the Playwright MCP registration added by newer images. After starting a container with an older persisted Codex directory, re-run:

```bash
codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080
```

### Running in Detached Mode

```bash
# Start a detached container with persistent auth mounts
docker run -dit --user sandbox --name hive-worker --restart unless-stopped \
  -v /root/.hive-mind/claude:/workspace/.claude \
  -v /root/.hive-mind/codex:/workspace/.codex \
  -v /root/.hive-mind/claude.json:/workspace/.claude.json \
  -v /root/.hive-mind/gh:/workspace/.config/gh \
  konard/hive-mind:latest bash -l -c 'bash /workspace/start-bot.sh'

# Execute commands in the running container
docker exec -it hive-worker bash

# Inside the container, run your commands
codex exec --model gpt-5.4-mini "hi"
solve https://github.com/owner/repo/issues/123
```

### Using with Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  hive-mind:
    image: konard/hive-mind:latest
    volumes:
      - sandbox-home:/workspace
    stdin_open: true
    tty: true

volumes:
  sandbox-home:
```

Then run:

```bash
docker-compose run --rm hive-mind
```

## Troubleshooting

### GitHub Authentication Issues

```bash
# Inside the container, check authentication status
gh auth status

# Re-authenticate if needed
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

### Claude Authentication Issues

```bash
# Inside the container, re-run Claude to authenticate
claude
```

### Docker Issues

```bash
# Check Docker status on host
docker info

# Pull the latest image
docker pull konard/hive-mind:latest

# Rebuild from source
docker build -t hive-mind:local .
```

### Build Issues

If you encounter issues building the image locally:

1. Ensure you have enough disk space (at least 20GB free)
2. Check your internet connection
3. Try building with more verbose output:
   ```bash
   docker build -t hive-mind:local --progress=plain .
   ```

## CI/CD Configuration for Docker Hub Publishing

If you're maintaining a fork or want to publish to your own Docker Hub account, follow these steps to configure GitHub Actions:

### Step 1: Create a Docker Hub Account

1. Go to [hub.docker.com](https://hub.docker.com)
2. Sign up or log in to your account
3. Note your Docker Hub username (e.g., `konard`)

### Step 2: Generate a Docker Hub Access Token

1. Log in to [hub.docker.com](https://hub.docker.com)
2. Click on your username in the top-right corner
3. Select **Account Settings** → **Security**
4. Click **New Access Token**
5. Enter a description (e.g., "GitHub Actions - Hive Mind")
6. Set permissions to **Read, Write, Delete** (required for publishing)
7. Click **Generate**
8. **IMPORTANT:** Copy the token immediately - you won't be able to see it again!
   - Example format: `dckr_pat_1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`

### Step 3: Add Secrets to GitHub Repository

1. Go to your GitHub repository (e.g., `https://github.com/konard/hive-mind`)
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add the following two secrets:

   **Secret 1: DOCKERHUB_USERNAME**
   - Name: `DOCKERHUB_USERNAME`
   - Value: Your Docker Hub username (e.g., `konard`)
   - Click **Add secret**

   **Secret 2: DOCKERHUB_TOKEN**
   - Name: `DOCKERHUB_TOKEN`
   - Value: The access token you generated in Step 2
   - Click **Add secret**

### Step 4: Update Docker Image Name

If using a fork, update the image name in `.github/workflows/docker-publish.yml`:

```yaml
env:
  REGISTRY: docker.io
  IMAGE_NAME: YOUR_DOCKERHUB_USERNAME/hive-mind # Change this to your username
```

### Step 5: Verify the Configuration

1. Push changes to the `main` branch
2. Go to **Actions** tab in your GitHub repository
3. Find the "Docker Build and Publish" workflow
4. Check that it completes successfully
5. Verify the image appears on [hub.docker.com/r/YOUR_USERNAME/hive-mind](https://hub.docker.com/r/konard/hive-mind)

### How It Works

- **On Pull Requests:** The workflow tests building the Docker image without publishing
- **On Main Branch:** The workflow builds and publishes to Docker Hub with the `latest` tag
- **On Version Tags:** The workflow publishes with semantic version tags (e.g., `v0.37.0`, `0.37`, `0`)

### Troubleshooting CI/CD

**Build fails with authentication error:**

- Verify `DOCKERHUB_USERNAME` matches your Docker Hub username exactly
- Regenerate `DOCKERHUB_TOKEN` and update the secret

**Image published but can't pull:**

- Ensure the repository on Docker Hub is public (or you're authenticated)
- Check [hub.docker.com](https://hub.docker.com) → Your repositories → hive-mind → Settings → Make Public

**Build succeeds but image doesn't appear:**

- Check you're pushing to the `main` branch (pull requests only test, don't publish)
- Verify the workflow ran in the Actions tab
- Check Docker Hub rate limits haven't been exceeded

## Security Notes

- Each container maintains its own isolated authentication
- No credentials are shared between containers
- No credentials are stored in the Docker image itself
- Authentication happens inside the container after it starts
- Each GitHub/Claude account can have its own container instance
- Docker Hub access tokens should be stored only as GitHub Secrets, never committed to the repository
