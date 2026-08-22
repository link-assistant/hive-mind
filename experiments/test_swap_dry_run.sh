#!/usr/bin/env bash
set -euo pipefail

echo "[DRY RUN] Testing swap file creation logic (simulation)..."

# Simulate the checks from the function
echo "[DRY RUN] Checking if /swapfile exists..."
if [ -f /swapfile ]; then
    echo "[DRY RUN] ✓ /swapfile exists"
    if swapon --show | grep -q /swapfile; then
        echo "[DRY RUN] ✓ /swapfile is active"
    else
        echo "[DRY RUN] ✗ /swapfile exists but not active"
    fi
else
    echo "[DRY RUN] ✗ /swapfile does not exist"
fi

echo ""
echo "[DRY RUN] Checking available disk space..."
available_space_kb=$(df / | awk 'NR==2 {print $4}')
required_space_kb=$((3 * 1024 * 1024))  # 3GB in KB
available_gb=$(($available_space_kb/1024/1024))

echo "[DRY RUN] Available space: ${available_gb}GB"
echo "[DRY RUN] Required space: 3GB"

if [ "$available_space_kb" -lt "$required_space_kb" ]; then
    echo "[DRY RUN] ✗ Insufficient disk space"
else
    echo "[DRY RUN] ✓ Sufficient disk space available"
fi

echo ""
echo "[DRY RUN] Checking command availability..."
if command -v fallocate >/dev/null 2>&1; then
    echo "[DRY RUN] ✓ fallocate is available"
else
    echo "[DRY RUN] ✗ fallocate not available, would use dd"
fi

echo ""
echo "[DRY RUN] Checking /etc/fstab for existing entry..."
if grep -q "/swapfile" /etc/fstab 2>/dev/null; then
    echo "[DRY RUN] ✓ /swapfile entry already exists in /etc/fstab"
else
    echo "[DRY RUN] ✗ No /swapfile entry in /etc/fstab"
fi

echo ""
echo "[DRY RUN] Current system status:"
echo "Current swap:"
swapon --show || echo "No active swap"
echo ""
echo "Memory usage:"
free -h

echo ""
echo "[DRY RUN] All checks completed successfully!"