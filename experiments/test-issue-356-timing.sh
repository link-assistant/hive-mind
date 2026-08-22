#!/bin/bash
# Test timing issues - what if command is sent too soon after session creation?

set -e

SESSION_NAME="test-timing-356-$$"
MARKER_FILE="/tmp/test-timing-marker-$$.txt"

echo "=== Testing Issue #356: Timing Issues ==="
echo ""

cleanup() {
    echo "Cleaning up..."
    screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
    rm -f "$MARKER_FILE"
}

trap cleanup EXIT

echo "Test 1: Send command immediately after 'exec bash'"
echo "This simulates the exact scenario from start-screen.mjs"
echo ""

# Replicate what start-screen does: run a quick command, then exec bash
screen -dmS "$SESSION_NAME" bash -c 'echo "First command"; exec bash'

# Try to send a command immediately - this might be too soon
echo "Sending command with NO delay after session creation..."
screen -S "$SESSION_NAME" -X stuff "echo 'Immediate command' > $MARKER_FILE\n"
sleep 0.5

if [ -f "$MARKER_FILE" ]; then
    echo "✓ Immediate command worked"
else
    echo "✗ Immediate command failed (exec bash might not be ready)"
    # Wait a bit more
    sleep 2
    if [ -f "$MARKER_FILE" ]; then
        echo "  ✓ But it worked after waiting"
    else
        echo "  ✗ Still failed after waiting"
    fi
fi

# Cleanup for next test
screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
rm -f "$MARKER_FILE"
sleep 1

echo ""
echo "Test 2: Send command with 1 second delay after session creation"
screen -dmS "$SESSION_NAME" bash -c 'echo "First command"; exec bash'
sleep 1  # Wait for exec bash to be ready

screen -S "$SESSION_NAME" -X stuff "echo 'Delayed command' > $MARKER_FILE\n"
sleep 0.5

if [ -f "$MARKER_FILE" ]; then
    echo "✓ Delayed command worked"
else
    echo "✗ Delayed command failed"
fi

# Cleanup for next test
screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
rm -f "$MARKER_FILE"
sleep 1

echo ""
echo "Test 3: Test with a long-running first command"
screen -dmS "$SESSION_NAME" bash -c 'echo "Starting long command"; sleep 3; echo "Long command done"; exec bash'

echo "Sending command 1 second after session creation (while first command is running)..."
sleep 1
screen -S "$SESSION_NAME" -X stuff "echo 'Command during sleep' > $MARKER_FILE\n"
sleep 1

if [ -f "$MARKER_FILE" ]; then
    echo "✗ UNEXPECTED: Command executed during first command"
else
    echo "✓ EXPECTED: Command not executed yet (first command still running)"
fi

echo "Waiting for first command to complete..."
sleep 3  # Wait for sleep to finish and exec bash to start
sleep 1  # Give exec bash time to be ready

if [ -f "$MARKER_FILE" ]; then
    echo "✓ Command executed after first command completed"
else
    echo "✗ Command still not executed even after first command completed"
    echo "  This is the BUG!"

    # Check screen state
    if screen -ls | grep -q "$SESSION_NAME"; then
        echo "  Session still exists"
        screen -S "$SESSION_NAME" -X hardcopy /tmp/screen-hardcopy-$$.txt
        sleep 0.5
        echo "  Screen buffer:"
        cat /tmp/screen-hardcopy-$$.txt
    else
        echo "  Session terminated!"
    fi
fi

echo ""
echo "=== Analysis ==="
echo "The issue occurs when:"
echo "1. A command is sent via 'screen -X stuff' while the previous command is still running"
echo "2. The command text gets 'stuffed' into the input buffer"
echo "3. But since there's no prompt yet, it doesn't execute"
echo "4. Once the prompt appears, the command should execute"
echo ""
echo "However, there might be cases where the buffered input gets lost or"
echo "doesn't execute properly, especially if there are terminal state issues."
