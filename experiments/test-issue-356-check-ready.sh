#!/bin/bash
# Test different ways to check if a screen session is ready

set -e

SESSION_NAME="test-ready-356-$$"

echo "=== Testing Ways to Check if Screen Session is Ready ==="
echo ""

cleanup() {
    echo "Cleaning up..."
    screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
    rm -f /tmp/screen-hardcopy-$$.txt
    rm -f /tmp/test-ready-$$.txt
}

trap cleanup EXIT

echo "Method 1: Check screen buffer for bash prompt"
screen -dmS "$SESSION_NAME" bash -c 'echo "Starting..."; sleep 2; echo "Done"; exec bash'
sleep 0.5

# Try to capture the screen buffer
screen -S "$SESSION_NAME" -X hardcopy /tmp/screen-hardcopy-$$.txt
sleep 0.5

if [ -f /tmp/screen-hardcopy-$$.txt ]; then
    echo "Screen buffer content:"
    cat /tmp/screen-hardcopy-$$.txt
    echo ""

    # Check if there's a prompt (common prompt patterns: $, %, >, #)
    if grep -E '(\$|%|>|#)[[:space:]]*$' /tmp/screen-hardcopy-$$.txt > /dev/null; then
        echo "✓ Prompt detected in buffer"
    else
        echo "✗ No prompt detected yet"
    fi
fi

echo ""
echo "Method 2: Wait for screen buffer to show prompt"
echo "Waiting for command to complete..."
sleep 3

rm -f /tmp/screen-hardcopy-$$.txt
screen -S "$SESSION_NAME" -X hardcopy /tmp/screen-hardcopy-$$.txt
sleep 0.5

echo "Screen buffer after waiting:"
cat /tmp/screen-hardcopy-$$.txt
echo ""

if grep -E '(\$|%|>|#)[[:space:]]*$' /tmp/screen-hardcopy-$$.txt > /dev/null; then
    echo "✓ Prompt detected after waiting"
else
    echo "? Still no clear prompt pattern"
fi

echo ""
echo "Method 3: Send a test command to verify readiness"
# Send a simple test command that creates a marker file
screen -S "$SESSION_NAME" -X stuff "touch /tmp/test-ready-$$.txt\n"
sleep 0.5

if [ -f /tmp/test-ready-$$.txt ]; then
    echo "✓ Test command executed - session is ready"
else
    echo "✗ Test command failed - session not ready"
    sleep 2
    if [ -f /tmp/test-ready-$$.txt ]; then
        echo "  ✓ But worked after additional wait"
    fi
fi

echo ""
echo "=== Recommended Solution ==="
echo "Since detecting prompt is unreliable, the best approach is to:"
echo "1. Wait a short time (e.g., 1 second) after sending command via 'stuff'"
echo "2. Verify the command executed by checking for expected output/side effects"
echo "3. If failed, either retry or inform the user"
echo ""
echo "Alternative: Instead of using 'stuff', create a more robust mechanism:"
echo "- Use a named pipe or file-based queue for commands"
echo "- Have a background process in the screen session that reads and executes commands"
echo "- This ensures commands are queued and executed in order when ready"
