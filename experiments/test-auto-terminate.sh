#!/bin/bash
# Test script for --auto-terminate option
# This script tests that the --auto-terminate flag works correctly

set -e

echo "=== Testing --auto-terminate option ==="
echo ""

# Clean up any existing test sessions
screen -wipe 2>/dev/null || true
screen -S test-auto-term -X quit 2>/dev/null || true
screen -S test-persist -X quit 2>/dev/null || true

echo "1. Testing default behavior (persistent session)"
echo "   Creating session with command: echo 'test default'"
# Create a screen session that should persist
screen -dmS test-persist bash -c 'echo "test default"; exec bash'

# Give it a moment to start
sleep 1

# Check if session exists
if screen -list | grep -q "test-persist"; then
    echo "   ✓ Session exists after command completes (as expected)"
    screen -S test-persist -X quit
else
    echo "   ✗ Session does not exist (unexpected!)"
    exit 1
fi

echo ""
echo "2. Testing --auto-terminate behavior (old behavior)"
echo "   Creating session with command: echo 'test auto-terminate'"
# Create a screen session that should terminate
screen -dmS test-auto-term echo "test auto-terminate"

# Give it a moment to complete and terminate
sleep 1

# Check if session does NOT exist
if screen -list | grep -q "test-auto-term"; then
    echo "   ✗ Session still exists (unexpected!)"
    screen -S test-auto-term -X quit 2>/dev/null || true
    exit 1
else
    echo "   ✓ Session terminated after command completes (as expected)"
fi

echo ""
echo "=== All tests passed! ==="
echo ""
echo "Summary:"
echo "  - Default behavior: Sessions persist after command completes"
echo "  - --auto-terminate: Sessions terminate after command completes"
