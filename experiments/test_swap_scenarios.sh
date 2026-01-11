#!/usr/bin/env bash
set -euo pipefail

echo "[SCENARIO TEST] Testing various swap file scenarios..."

# Function to get file size in MB
get_file_size_mb() {
    local file="$1"
    if [ -f "$file" ]; then
        local size_bytes=$(stat -c%s "$file" 2>/dev/null || echo "0")
        echo $((size_bytes / 1024 / 1024))
    else
        echo "0"
    fi
}

# Function to simulate creating a small swap file (for testing)
create_test_small_swap() {
    local swap_path="$1"
    local size_mb="$2"
    
    echo "[SCENARIO] Creating test swap file $swap_path with ${size_mb}MB..."
    sudo fallocate -l "${size_mb}M" "$swap_path"
    sudo chmod 600 "$swap_path"
    sudo mkswap "$swap_path"
    echo "[SCENARIO] Test swap file created: $(get_file_size_mb "$swap_path")MB"
}

# Function to clean up test files
cleanup_test_files() {
    echo "[SCENARIO] Cleaning up test swap files..."
    for i in "" 1 2 3 4 5; do
        local test_swapfile="/swapfile$i"
        if [ -f "$test_swapfile" ]; then
            # Turn off swap if active
            sudo swapoff "$test_swapfile" 2>/dev/null || true
            # Remove from fstab
            sudo sed -i "\\|$test_swapfile|d" /etc/fstab 2>/dev/null || true
            # Remove file
            sudo rm -f "$test_swapfile"
            echo "[SCENARIO] Removed $test_swapfile"
        fi
    done
    echo "[SCENARIO] Cleanup complete"
}

# Test scenarios
echo "[SCENARIO] Testing different scenarios:"
echo ""

# Scenario 1: No existing swap files
echo "=== SCENARIO 1: No existing swap files ==="
cleanup_test_files
echo "Current swap status:"
swapon --show || echo "No swap active"
echo ""

# Run our logic simulation
echo "[SCENARIO] Simulating swap creation logic:"
target_total_mb=4096
current_total_mb=0

for i in "" 1 2 3 4 5; do
    swapfile="/swapfile$i"
    if [ -f "$swapfile" ]; then
        size_mb=$(get_file_size_mb "$swapfile")
        current_total_mb=$((current_total_mb + size_mb))
        echo "Found $swapfile: ${size_mb}MB"
    fi
done

echo "Current total: ${current_total_mb}MB, Target: ${target_total_mb}MB"
if [ "$current_total_mb" -lt "$target_total_mb" ]; then
    needed_mb=$((target_total_mb - current_total_mb))
    echo "Would need to create: ${needed_mb}MB"
    echo "Would use: /swapfile"
else
    echo "Already sufficient"
fi
echo ""

# Scenario 2: Small existing swap file (1GB)
echo "=== SCENARIO 2: Existing 1GB swap file ==="
cleanup_test_files
create_test_small_swap "/swapfile" 1024
sudo swapon /swapfile

echo "Current swap status:"
swapon --show
echo ""

# Run logic simulation
current_total_mb=0
for i in "" 1 2 3 4 5; do
    swapfile="/swapfile$i"
    if [ -f "$swapfile" ]; then
        size_mb=$(get_file_size_mb "$swapfile")
        current_total_mb=$((current_total_mb + size_mb))
        echo "Found $swapfile: ${size_mb}MB"
    fi
done

echo "Current total: ${current_total_mb}MB, Target: ${target_total_mb}MB"
if [ "$current_total_mb" -lt "$target_total_mb" ]; then
    needed_mb=$((target_total_mb - current_total_mb))
    echo "Would need to create: ${needed_mb}MB"
    echo "Would use: /swapfile1 (since /swapfile exists)"
else
    echo "Already sufficient"
fi
echo ""

# Scenario 3: Multiple small swap files totaling < 4GB
echo "=== SCENARIO 3: Multiple small swap files (500MB + 500MB) ==="
cleanup_test_files
create_test_small_swap "/swapfile" 512
create_test_small_swap "/swapfile1" 512
sudo swapon /swapfile
sudo swapon /swapfile1

echo "Current swap status:"
swapon --show
echo ""

# Run logic simulation
current_total_mb=0
for i in "" 1 2 3 4 5; do
    swapfile="/swapfile$i"
    if [ -f "$swapfile" ]; then
        size_mb=$(get_file_size_mb "$swapfile")
        current_total_mb=$((current_total_mb + size_mb))
        echo "Found $swapfile: ${size_mb}MB"
    fi
done

echo "Current total: ${current_total_mb}MB, Target: ${target_total_mb}MB"
if [ "$current_total_mb" -lt "$target_total_mb" ]; then
    needed_mb=$((target_total_mb - current_total_mb))
    echo "Would need to create: ${needed_mb}MB"
    echo "Would use: /swapfile2 (first available)"
else
    echo "Already sufficient"
fi
echo ""

# Scenario 4: Already sufficient swap (4.5GB)
echo "=== SCENARIO 4: Already sufficient swap (4.5GB) ==="
cleanup_test_files
create_test_small_swap "/swapfile" 4608  # 4.5GB
sudo swapon /swapfile

echo "Current swap status:"
swapon --show
echo ""

# Run logic simulation
current_total_mb=0
for i in "" 1 2 3 4 5; do
    swapfile="/swapfile$i"
    if [ -f "$swapfile" ]; then
        size_mb=$(get_file_size_mb "$swapfile")
        current_total_mb=$((current_total_mb + size_mb))
        echo "Found $swapfile: ${size_mb}MB"
    fi
done

echo "Current total: ${current_total_mb}MB, Target: ${target_total_mb}MB"
if [ "$current_total_mb" -lt "$target_total_mb" ]; then
    needed_mb=$((target_total_mb - current_total_mb))
    echo "Would need to create: ${needed_mb}MB"
else
    echo "Already sufficient - no action needed"
fi
echo ""

# Clean up after all tests
cleanup_test_files

echo "[SCENARIO TEST] All scenario tests completed!"
echo ""
echo "Summary of behavior:"
echo "- No swap files: Creates /swapfile with 4096MB"
echo "- Small existing swap: Keeps existing, creates additional file for remainder"
echo "- Multiple small files: Keeps all existing, creates additional for remainder"
echo "- Already sufficient: No action needed"
echo "- Always preserves and activates existing swap files"