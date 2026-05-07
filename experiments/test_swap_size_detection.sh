#!/usr/bin/env bash
set -euo pipefail

echo "[EXPERIMENT] Testing swap file size detection methods..."

# Function to get swap file size in MB
get_swap_size_mb() {
    local swap_file="$1"
    
    if [ ! -f "$swap_file" ]; then
        echo "0"
        return
    fi
    
    # Method 1: Using stat to get file size
    local size_bytes=$(stat -c%s "$swap_file" 2>/dev/null || echo "0")
    local size_mb=$((size_bytes / 1024 / 1024))
    echo "$size_mb"
}

# Function to get active swap size from swapon
get_active_swap_size_mb() {
    local swap_file="$1"
    
    # Get size from swapon output (in KB, convert to MB)
    local size_kb=$(swapon --show=SIZE --noheadings --bytes "$swap_file" 2>/dev/null | head -1 || echo "0")
    local size_mb=$((size_kb / 1024 / 1024))
    echo "$size_mb"
}

echo "[EXPERIMENT] Current system swap status:"
swapon --show || echo "No swap active"
echo ""

# Test if /swapfile exists
if [ -f /swapfile ]; then
    echo "[EXPERIMENT] /swapfile exists"
    
    file_size_mb=$(get_swap_size_mb "/swapfile")
    echo "File size: ${file_size_mb}MB"
    
    if swapon --show | grep -q /swapfile; then
        active_size_mb=$(get_active_swap_size_mb "/swapfile")
        echo "Active swap size: ${active_size_mb}MB"
    else
        echo "Swap file exists but not active"
    fi
    
    target_size_mb=4096  # 4GB
    if [ "$file_size_mb" -lt "$target_size_mb" ]; then
        needed_mb=$((target_size_mb - file_size_mb))
        echo "Existing swap is smaller than 4GB. Need ${needed_mb}MB more."
    else
        echo "Existing swap is already 4GB or larger."
    fi
else
    echo "[EXPERIMENT] /swapfile does not exist"
fi

echo ""
echo "[EXPERIMENT] Testing alternative swap file names..."
for i in {1..5}; do
    alt_swapfile="/swapfile$i"
    if [ -f "$alt_swapfile" ]; then
        size_mb=$(get_swap_size_mb "$alt_swapfile")
        echo "Found $alt_swapfile: ${size_mb}MB"
    else
        echo "Available name: $alt_swapfile"
        break
    fi
done

echo "[EXPERIMENT] Experiment completed!"