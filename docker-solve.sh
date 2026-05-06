#!/bin/bash

# Docker wrapper for solve.mjs
# Usage: ./docker-solve.sh [solve.mjs arguments]

set -e

echo "🐳 Running solve.mjs in Docker container..."
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker daemon is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker daemon is not running"
    echo "Please start Docker first"
    exit 1
fi

# Create output directory if it doesn't exist
mkdir -p ./output

# Build the Docker image if it doesn't exist or if --build is passed
if [[ "$1" == "--build" ]] || [[ "$(docker images -q hive-mind-solver 2> /dev/null)" == "" ]]; then
    echo "🔨 Building Docker image..."
    docker build -t hive-mind-solver .
    if [[ "$1" == "--build" ]]; then
        shift # Remove --build from arguments
    fi
fi

# Pass all arguments to solve.mjs inside the container
echo "🚀 Starting solve.mjs with arguments: $*"
echo ""

# Run the container with proper volume mounts and argument passing
docker run --rm -it \
    -v ~/.config/gh:/home/box/.persisted-configs/gh:ro \
    -v ~/.local/share/claude-profiles:/home/box/.persisted-configs/claude:ro \
    -v ~/.config/claude-code:/home/box/.persisted-configs/claude-code:ro \
    -v "$(pwd)/output:/home/box/output" \
    -e GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
    -e CLAUDE_API_KEY="${CLAUDE_API_KEY:-}" \
    hive-mind-solver \
    bash -c "
        # Restore credentials first
        ./docker-restore-auth.sh
        echo ''
        # Then run the solve script with passed arguments
        ./solve.mjs $*
    "

echo ""
echo "🎉 Docker execution completed!"
echo "📁 Check ./output/ directory for any generated files"