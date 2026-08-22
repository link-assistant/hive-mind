#!/bin/bash

# Simple test to verify memory information parsing
echo "=== Current Memory Information ==="
grep -E "MemAvailable|MemFree|SwapFree|SwapTotal" /proc/meminfo

echo ""
echo "=== Parsed Values ==="
# Parse memory values (they're in kB)
AVAILABLE=$(grep "MemAvailable:" /proc/meminfo | awk '{print $2}')
FREE=$(grep "MemFree:" /proc/meminfo | awk '{print $2}')
SWAP_FREE=$(grep "SwapFree:" /proc/meminfo | awk '{print $2}')
SWAP_TOTAL=$(grep "SwapTotal:" /proc/meminfo | awk '{print $2}')

# Convert to MB
AVAILABLE_MB=$((AVAILABLE / 1024))
FREE_MB=$((FREE / 1024))
SWAP_FREE_MB=$((SWAP_FREE / 1024))
SWAP_TOTAL_MB=$((SWAP_TOTAL / 1024))

echo "Available RAM: ${AVAILABLE_MB}MB"
echo "Free RAM: ${FREE_MB}MB"
echo "Free Swap: ${SWAP_FREE_MB}MB"
echo "Total Swap: ${SWAP_TOTAL_MB}MB"

# Calculate effective available memory (RAM + swap)
EFFECTIVE_AVAILABLE_MB=$((AVAILABLE_MB + SWAP_FREE_MB))

echo "Effective Available: ${EFFECTIVE_AVAILABLE_MB}MB"

echo ""
echo "=== Test Memory Check Logic (256MB required) ==="
MIN_MEMORY_MB=256

if [ $AVAILABLE_MB -lt $MIN_MEMORY_MB ]; then
    if [ $EFFECTIVE_AVAILABLE_MB -ge $MIN_MEMORY_MB ]; then
        echo "⚠️  Low RAM: ${AVAILABLE_MB}MB available, ${MIN_MEMORY_MB}MB required, but ${SWAP_FREE_MB}MB swap available"
        echo "   Continuing with swap support (effective memory: ${EFFECTIVE_AVAILABLE_MB}MB)"
        echo "✅ RESULT: WOULD CONTINUE (with swap)"
    else
        echo "❌ Insufficient memory: ${AVAILABLE_MB}MB available + ${SWAP_FREE_MB}MB swap = ${EFFECTIVE_AVAILABLE_MB}MB total, ${MIN_MEMORY_MB}MB required"
        echo "❌ RESULT: WOULD FAIL"
    fi
else
    echo "✅ Memory check passed: ${AVAILABLE_MB}MB available (${MIN_MEMORY_MB}MB required)"
    echo "✅ RESULT: WOULD PASS"
fi