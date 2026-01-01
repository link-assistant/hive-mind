# Docker Installation

This document covers Docker installation for Hive Mind. For usage instructions after installation, see [USAGE.md](./USAGE.md).

## Quick Start

### Option 1: Pre-built Image from Docker Hub (Recommended)

```bash
# Pull the latest image
docker pull konard/hive-mind:latest

# Run an interactive session
docker run -it konard/hive-mind:latest

# Inside the container, authenticate:
gh-setup-git-identity
claude

# Ready to use! See USAGE.md for commands
```

### Option 2: Building Locally

```bash
# Build the production image
docker build -t hive-mind:local .

# Run the image
docker run -it hive-mind:local
```

### Option 3: Development Mode (Gitpod-style)

For development purposes:

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

## Prerequisites

1. **Docker:** Install Docker Desktop or Docker Engine (version 20.10 or higher)
2. **Internet Connection:** Required for pulling images and authentication

## Authentication

Authentication is performed **inside the container AFTER** the Docker image is running.

**Why Authentication Happens After Installation:**

- Avoids Docker build timeouts caused by interactive prompts
- Prevents build failures in CI/CD pipelines
- Allows the installation script to complete successfully
- Supports automated Docker image builds

### GitHub Authentication

```bash
# Inside the container
gh-setup-git-identity
# Or manually:
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

### Claude Authentication

```bash
# Inside the container
claude
```

This approach allows:

- Multiple Docker instances with different GitHub accounts
- Multiple Docker instances with different Claude subscriptions
- No credential leakage between containers
- Each container has its own isolated authentication

## Persistent Storage

To persist authentication and work between container restarts:

```bash
# Create a volume for the hive user's home directory
docker volume create hive-home

# Run with the volume mounted
docker run -it -v hive-home:/home/hive konard/hive-mind:latest
```

## Running in Detached Mode

```bash
# Start a detached container
docker run -d --name hive-worker -v hive-home:/home/hive konard/hive-mind:latest sleep infinity

# Execute commands in the running container
docker exec -it hive-worker bash
```

## Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  hive-mind:
    image: konard/hive-mind:latest
    volumes:
      - hive-home:/home/hive
    stdin_open: true
    tty: true

volumes:
  hive-home:
```

Then run:

```bash
docker-compose run --rm hive-mind
```

## Troubleshooting

### GitHub Authentication Issues

```bash
# Check authentication status
gh auth status

# Re-authenticate if needed
gh auth login -h github.com -s repo,workflow,user,read:org,gist
```

### Claude Authentication Issues

```bash
# Re-run Claude to authenticate
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

If you're maintaining a fork or want to publish to your own Docker Hub account:

### Step 1: Create a Docker Hub Account

1. Go to [hub.docker.com](https://hub.docker.com)
2. Sign up or log in to your account
3. Note your Docker Hub username (e.g., `konard`)

### Step 2: Generate a Docker Hub Access Token

1. Log in to [hub.docker.com](https://hub.docker.com)
2. Click on your username in the top-right corner
3. Select **Account Settings** -> **Security**
4. Click **New Access Token**
5. Enter a description (e.g., "GitHub Actions - Hive Mind")
6. Set permissions to **Read, Write, Delete** (required for publishing)
7. Click **Generate**
8. **IMPORTANT:** Copy the token immediately - you won't be able to see it again!

### Step 3: Add Secrets to GitHub Repository

1. Go to your GitHub repository
2. Click **Settings** -> **Secrets and variables** -> **Actions**
3. Click **New repository secret**
4. Add the following two secrets:

   **Secret 1: DOCKERHUB_USERNAME**
   - Name: `DOCKERHUB_USERNAME`
   - Value: Your Docker Hub username

   **Secret 2: DOCKERHUB_TOKEN**
   - Name: `DOCKERHUB_TOKEN`
   - Value: The access token you generated

### Step 4: Update Docker Image Name

If using a fork, update the image name in `.github/workflows/docker-publish.yml`:

```yaml
env:
  REGISTRY: docker.io
  IMAGE_NAME: YOUR_DOCKERHUB_USERNAME/hive-mind
```

### How It Works

- **On Pull Requests:** The workflow tests building the Docker image without publishing
- **On Main Branch:** The workflow builds and publishes to Docker Hub with the `latest` tag
- **On Version Tags:** The workflow publishes with semantic version tags (e.g., `v0.37.0`, `0.37`, `0`)

### Troubleshooting CI/CD

**Build fails with authentication error:**

- Verify `DOCKERHUB_USERNAME` matches your Docker Hub username exactly
- Regenerate `DOCKERHUB_TOKEN` and update the secret

**Image published but can't pull:**

- Ensure the repository on Docker Hub is public
- Check Docker Hub -> Your repositories -> hive-mind -> Settings -> Make Public

**Build succeeds but image doesn't appear:**

- Check you're pushing to the `main` branch (pull requests only test, don't publish)
- Verify the workflow ran in the Actions tab
- Check Docker Hub rate limits haven't been exceeded

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
    ├── DOCKER.md                 # This file
    └── USAGE.md                  # Usage instructions (CLI and Telegram bot)
```

## Security Notes

- Each container maintains its own isolated authentication
- No credentials are shared between containers
- No credentials are stored in the Docker image itself
- Authentication happens inside the container after it starts
- Each GitHub/Claude account can have its own container instance
- Docker Hub access tokens should be stored only as GitHub Secrets, never committed to the repository

## Next Steps

After installation and authentication, see [USAGE.md](./USAGE.md) for:

- CLI commands (`solve`, `hive`)
- Telegram bot setup
- All available options
