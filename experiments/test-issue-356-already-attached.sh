#!/bin/bash
# Test what happens when screen session is already attached

set -e

SESSION_NAME="test-already-attached-356-$$"
MARKER_FILE="/tmp/test-already-attached-$$.txt"

echo "=== Testing Issue #356: Screen Already Attached ==="
echo ""

cleanup() {
    echo "Cleaning up..."
    screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
    rm -f "$MARKER_FILE"
    rm -f /tmp/attach-test-$$.log
}

trap cleanup EXIT

echo "Step 1: Create screen session"
screen -dmS "$SESSION_NAME" bash
sleep 1

if screen -ls | grep -q "$SESSION_NAME"; then
    echo "✓ Session created: $SESSION_NAME"
else
    echo "✗ Failed to create session"
    exit 1
fi

echo ""
echo "Step 2: Attach to the session (simulating user attached)"
echo "This runs in background to keep the session attached"

# Start a background process that attaches to the screen
# We'll use script command to simulate an interactive attachment
(
    # Try to attach to the screen session for a few seconds
    timeout 5 screen -R "$SESSION_NAME" || true
) &> /tmp/attach-test-$$.log &
ATTACH_PID=$!
sleep 1

echo ""
echo "Step 3: Try to send command while session is attached"
screen -S "$SESSION_NAME" -X stuff "echo 'Command sent while attached' > $MARKER_FILE\n"
sleep 1

if [ -f "$MARKER_FILE" ]; then
    echo "✓ Command executed even while attached"
    echo "  Content: $(cat $MARKER_FILE)"
else
    echo "? Command might not have executed while attached"
fi

# Kill the attach process
kill $ATTACH_PID 2>/dev/null || true
wait $ATTACH_PID 2>/dev/null || true

echo ""
echo "Step 4: Send command after detaching"
rm -f "$MARKER_FILE"
screen -S "$SESSION_NAME" -X stuff "echo 'Command after detach' > $MARKER_FILE\n"
sleep 1

if [ -f "$MARKER_FILE" ]; then
    echo "✓ Command executed after detaching"
else
    echo "✗ Command still not working"
fi

echo ""
echo "Note: The 'already attached' scenario might not be the issue,"
echo "since screen -X stuff should work regardless of attachment status."
