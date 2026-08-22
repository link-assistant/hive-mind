#!/bin/bash
# Test to reproduce the race condition in issue #356
# This test shows the problem: when a command is still running,
# sending a new command via screen -X stuff doesn't work properly

set -e

SESSION_NAME="test-race-356-$$"
MARKER_FILE="/tmp/test-race-marker-$$.txt"

echo "=== Testing Race Condition in Issue #356 ==="
echo ""

cleanup() {
    echo "Cleaning up..."
    screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
    rm -f "$MARKER_FILE"
    rm -f /tmp/screen-hardcopy-$$.txt
}

trap cleanup EXIT

echo "Step 1: Create a screen session with a long-running command"
# Simulate what start-screen does: run a command, then exec bash
screen -dmS "$SESSION_NAME" bash -c 'echo "Command started"; sleep 5; echo "Command finished"; exec bash'
sleep 0.5

if screen -ls | grep -q "$SESSION_NAME"; then
    echo "✓ Session created: $SESSION_NAME"
else
    echo "✗ Failed to create session"
    exit 1
fi

echo ""
echo "Step 2: Try to send a command while the first command is still running"
echo "This simulates calling start-screen again while the first solve is running"
sleep 1  # Let the first command start but not finish (it sleeps for 5 seconds)

# Try to send a new command
screen -S "$SESSION_NAME" -X stuff "echo 'Second command' > $MARKER_FILE\n"
sleep 1

echo ""
echo "Step 3: Check if the second command was executed"
if [ -f "$MARKER_FILE" ]; then
    echo "✗ UNEXPECTED: Command was executed while first command was running"
    echo "  This means the command was somehow queued or executed in parallel"
else
    echo "✓ EXPECTED BEHAVIOR: Command was NOT executed immediately"
    echo "  This is the bug - the command is sent but doesn't execute properly"
fi

echo ""
echo "Step 4: Wait for the first command to finish and check again"
sleep 5  # Wait for the sleep to finish and bash to start
sleep 1  # Give bash a moment to be ready

if [ -f "$MARKER_FILE" ]; then
    echo "✓ Command eventually executed after first command finished"
else
    echo "✗ Command still not executed even after waiting"
    echo "  Let's check the screen buffer to see what happened:"
    screen -S "$SESSION_NAME" -X hardcopy /tmp/screen-hardcopy-$$.txt
    cat /tmp/screen-hardcopy-$$.txt
fi

echo ""
echo "Step 5: Test sending a command when the session is at a clean prompt"
rm -f "$MARKER_FILE"
screen -S "$SESSION_NAME" -X stuff "echo 'Third command at clean prompt' > $MARKER_FILE\n"
sleep 1

if [ -f "$MARKER_FILE" ]; then
    echo "✓ Command executed successfully at clean prompt"
else
    echo "✗ Command still failed at clean prompt"
fi

echo ""
echo "=== Analysis ==="
echo "This test demonstrates the race condition:"
echo "- Sending commands via 'screen -X stuff' while another command is running"
echo "  may result in the command being typed but not executed properly."
echo "- The command text appears in the session but doesn't run until the"
echo "  current command finishes and returns to a prompt."
echo ""
echo "Potential solutions:"
echo "1. Check if a command is currently running before sending a new one"
echo "2. Queue commands or wait for the session to be ready"
echo "3. Add a mechanism to detect when the session is at a clean prompt"
echo "4. Use a different approach like creating a command queue file"
