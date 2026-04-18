#!/usr/bin/env bash
set -euo pipefail

echo "[TEST] Testing swap file creation function..."

# --- Function: create swap file ---
create_swap_file() {
  echo "[*] Setting up 4GB total swap space..."

  local target_total_mb=4096  # 4GB target
  local current_total_mb=0
  
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
  
  # Check existing swap files and calculate total
  echo "[*] Checking existing swap configuration..."
  for i in "" 1 2 3 4 5; do
    local swapfile="/swapfile$i"
    if [ -f "$swapfile" ]; then
      local size_mb=$(get_file_size_mb "$swapfile")
      current_total_mb=$((current_total_mb + size_mb))
      echo "[*] Found $swapfile: ${size_mb}MB"
      
      # Activate if not already active
      if ! swapon --show | grep -q "$swapfile"; then
        echo "[*] Activating $swapfile..."
        sudo swapon "$swapfile" || true
      fi
    fi
  done
  
  echo "[*] Current total swap: ${current_total_mb}MB, Target: ${target_total_mb}MB"
  
  # If we already have enough swap, we're done
  if [ "$current_total_mb" -ge "$target_total_mb" ]; then
    echo "[*] Already have sufficient swap space (${current_total_mb}MB >= ${target_total_mb}MB)"
    return 0
  fi
  
  # Calculate how much additional swap we need
  local needed_mb=$((target_total_mb - current_total_mb))
  echo "[*] Need to create ${needed_mb}MB additional swap space..."
  
  # Check available disk space (need extra margin for safety)
  local available_space_kb=$(df / | awk 'NR==2 {print $4}')
  local needed_space_kb=$((needed_mb * 1024 + 1024 * 1024))  # needed + 1GB safety margin
  
  if [ "$available_space_kb" -lt "$needed_space_kb" ]; then
    echo "[!] Warning: Insufficient disk space for additional swap. Available: $(($available_space_kb/1024/1024))GB, Needed: $(($needed_space_kb/1024/1024))GB"
    return 1
  fi
  
  # Find next available swap file name
  local new_swapfile=""
  for i in "" 1 2 3 4 5; do
    local candidate="/swapfile$i"
    if [ ! -f "$candidate" ]; then
      new_swapfile="$candidate"
      break
    fi
  done
  
  if [ -z "$new_swapfile" ]; then
    echo "[!] Error: Cannot find available swap file name (checked /swapfile through /swapfile5)"
    return 1
  fi
  
  # Create additional swap file
  echo "[*] Creating ${needed_mb}MB swap file at $new_swapfile..."
  if command -v fallocate >/dev/null 2>&1; then
    sudo fallocate -l "${needed_mb}M" "$new_swapfile"
  else
    # Fallback to dd if fallocate is not available
    sudo dd if=/dev/zero of="$new_swapfile" bs=1M count="$needed_mb" status=progress
  fi
  
  # Set proper permissions
  sudo chmod 600 "$new_swapfile"
  
  # Format as swap
  sudo mkswap "$new_swapfile"
  
  # Enable swap file
  sudo swapon "$new_swapfile"
  
  # Make it persistent by adding to /etc/fstab if not already there
  if ! grep -q "$new_swapfile" /etc/fstab; then
    echo "[*] Adding $new_swapfile to /etc/fstab for persistence..."
    # Ensure we have a backup of fstab
    if [ ! -f /etc/fstab.backup ]; then
      sudo cp /etc/fstab /etc/fstab.backup
    fi
    echo "$new_swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
  fi
  
  # Verify swap is active and show final status
  if swapon --show | grep -q "$new_swapfile"; then
    echo "[*] Swap file $new_swapfile successfully created and activated."
    echo "[*] Final swap configuration:"
    swapon --show
    echo "[*] Total swap space: $((current_total_mb + needed_mb))MB"
  else
    echo "[!] Error: Swap file creation failed."
    return 1
  fi
}

# Pre-test checks
echo "[TEST] Current system status:"
echo "Available disk space:"
df -h /
echo ""
echo "Current swap status:"
swapon --show || echo "No swap currently active"
free -h
echo ""

# Test the function
echo "[TEST] Running create_swap_file function..."
if create_swap_file; then
    echo "[TEST] ✓ Swap file creation function succeeded"
else
    echo "[TEST] ✗ Swap file creation function failed"
    exit 1
fi

echo ""
echo "[TEST] Post-creation verification:"
echo "Swap status after creation:"
swapon --show
free -h

echo ""
echo "[TEST] Checking /etc/fstab entry:"
grep "/swapfile" /etc/fstab || echo "No fstab entry found"

echo ""
echo "[TEST] File permissions and details:"
ls -la /swapfile 2>/dev/null || echo "Swap file not found"

echo "[TEST] Test completed successfully!"