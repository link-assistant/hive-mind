#!/bin/bash
# Experiment to reproduce and test the screen session reuse bug

SESSION_NAME="test-screen-reuse-$$"

echo "=== Testing Screen Session Reuse Bug ==="
echo "Session name: $SESSION_NAME"
echo ""

# Cleanup any existing session
screen -S "$SESSION_NAME" -X quit 2>/dev/null || true

echo "Step 1: Create a screen session with a simple command"
screen -dmS "$SESSION_NAME" bash -c 'echo "First command executed"; sleep 2; exec bash'
sleep 1

echo "Step 2: Check if session exists"
if screen -ls | grep -q "$SESSION_NAME"; then
    echo "✓ Session created successfully"
else
    echo "✗ Session creation failed"
    exit 1
fi

echo ""
echo "Step 3: Simulate reusing the session by sending a new command"
echo "Sending: echo 'Second command executed'"
screen -S "$SESSION_NAME" -X stuff "echo 'Second command executed'\n"
sleep 1

echo ""
echo "Step 4: Capture the session output"
# Get the session's hardcopy (screen buffer)
screen -S "$SESSION_NAME" -X hardcopy /tmp/screen-hardcopy-$$.txt
sleep 0.5

echo "Session output:"
cat /tmp/screen-hardcopy-$$.txt 2>/dev/null || echo "(No output captured)"

echo ""
echo "Step 5: Cleanup"
screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
rm -f /tmp/screen-hardcopy-$$.txt

echo ""
echo "=== Test Complete ==="
