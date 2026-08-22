#!/bin/bash
# Simple test for the fix for issue #356

set -e

echo "=== Simple Test for Issue #356 Fix ==="
echo ""

# We'll create a fake 'solve' command for testing
FAKE_SOLVE="/tmp/fake-solve-test-$$.sh"
cat > "$FAKE_SOLVE" << 'EOF'
#!/bin/bash
echo "Solve executed with args: $@"
echo "Timestamp: $(date +%s)"
sleep 1
echo "Solve finished"
EOF
chmod +x "$FAKE_SOLVE"

# Add the fake solve to PATH
export PATH="/tmp:$PATH"
ln -sf "$FAKE_SOLVE" /tmp/solve

SESSION_NAME="solve-test-repo-999"

cleanup() {
    echo ""
    echo "Cleaning up..."
    rm -f /tmp/solve "$FAKE_SOLVE"
    screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
}

trap cleanup EXIT

# Clean up any existing session first
screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
sleep 1

echo "Step 1: Create initial session with start-screen"
node ./start-screen.mjs solve https://github.com/test/repo/issues/999 --first-run &
FIRST_PID=$!

echo "Waiting for session to be created (5 seconds)..."
sleep 5

if screen -ls | grep -q "$SESSION_NAME"; then
    echo "✓ Session created: $SESSION_NAME"
else
    echo "✗ Session not found"
    wait $FIRST_PID || true
    screen -ls
    exit 1
fi

echo ""
echo "Step 2: Send a second command to the existing session"
echo "(This is where the bug would occur - command not executing)"
node ./start-screen.mjs solve https://github.com/test/repo/issues/999 --second-run

echo ""
echo "Step 3: Wait and check if the second command executed"
sleep 3

screen -S "$SESSION_NAME" -X hardcopy /tmp/test-hardcopy-$$.txt
sleep 0.5

if [ -f /tmp/test-hardcopy-$$.txt ]; then
    echo ""
    echo "Screen buffer:"
    cat /tmp/test-hardcopy-$$.txt
    echo ""

    if grep -q "second-run" /tmp/test-hardcopy-$$.txt; then
        echo "✓✓✓ SUCCESS: Second command was executed!"
        echo "The fix is working!"
    else
        echo "✗✗✗ FAILED: Second command was not executed"
        echo "The bug still exists"
    fi

    rm -f /tmp/test-hardcopy-$$.txt
else
    echo "? Could not read screen buffer"
fi

echo ""
echo "Step 4: Test with a third command"
node ./start-screen.mjs solve https://github.com/test/repo/issues/999 --third-run

sleep 3
screen -S "$SESSION_NAME" -X hardcopy /tmp/test-hardcopy-2-$$.txt
sleep 0.5

if [ -f /tmp/test-hardcopy-2-$$.txt ]; then
    if grep -q "third-run" /tmp/test-hardcopy-2-$$.txt; then
        echo "✓ Third command also executed"
    fi
    rm -f /tmp/test-hardcopy-2-$$.txt
fi
