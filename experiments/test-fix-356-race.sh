#!/bin/bash
# Test the fix handles race conditions (command sent while another is running)

set -e

echo "=== Testing Fix Handles Race Conditions ==="
echo ""

# Create a fake 'solve' that takes longer to run
FAKE_SOLVE="/tmp/fake-solve-race-$$.sh"
cat > "$FAKE_SOLVE" << 'EOF'
#!/bin/bash
echo "=== Solve starting ==="
echo "Args: $@"
echo "This command will run for 5 seconds..."
sleep 5
echo "=== Solve finished ==="
EOF
chmod +x "$FAKE_SOLVE"

export PATH="/tmp:$PATH"
ln -sf "$FAKE_SOLVE" /tmp/solve

SESSION_NAME="solve-test-repo-888"

cleanup() {
    echo ""
    echo "Cleaning up..."
    rm -f /tmp/solve "$FAKE_SOLVE"
    screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
    rm -f /tmp/race-hardcopy-*.txt
}

trap cleanup EXIT

screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
sleep 1

echo "Step 1: Start a long-running command"
node ./start-screen.mjs solve https://github.com/test/repo/issues/888 --long-command &
sleep 3  # Let it start but not finish

if screen -ls | grep -q "$SESSION_NAME"; then
    echo "✓ Session created"
else
    echo "✗ Session not found"
    exit 1
fi

echo ""
echo "Step 2: Try to send another command while first is still running"
echo "(Testing the race condition scenario)"
node ./start-screen.mjs solve https://github.com/test/repo/issues/888 --second-while-running

echo ""
echo "Step 3: Wait for both commands to complete"
sleep 7  # First command takes 5 seconds + time for second command

screen -S "$SESSION_NAME" -X hardcopy /tmp/race-hardcopy-$$.txt
sleep 0.5

if [ -f /tmp/race-hardcopy-$$.txt ]; then
    echo ""
    echo "Screen buffer:"
    cat /tmp/race-hardcopy-$$.txt
    echo ""

    FIRST_COUNT=$(grep -c "long-command" /tmp/race-hardcopy-$$.txt || echo "0")
    SECOND_COUNT=$(grep -c "second-while-running" /tmp/race-hardcopy-$$.txt || echo "0")

    echo "Results:"
    echo "- First command executed: $FIRST_COUNT time(s)"
    echo "- Second command executed: $SECOND_COUNT time(s)"

    if [ "$FIRST_COUNT" -ge 1 ] && [ "$SECOND_COUNT" -ge 1 ]; then
        echo ""
        echo "✓✓✓ SUCCESS: Both commands executed despite race condition!"
        echo "The fix properly handles commands sent while another is running."
    else
        echo ""
        echo "✗ FAILED: Not all commands executed"
    fi
fi
