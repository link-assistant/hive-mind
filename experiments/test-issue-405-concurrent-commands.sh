#!/bin/bash
# Test fix for issue #405: Concurrent command execution should properly detect readiness
# This script verifies that the marker-based readiness detection works correctly

set -e

SESSION_NAME="test-issue-405-$$"
TEST_OUTPUT="/tmp/test-405-output-$$.txt"

echo "=== Testing Fix for Issue #405: Screen Readiness Detection ==="
echo ""

cleanup() {
    echo ""
    echo "Cleaning up..."
    screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
    rm -f /tmp/screen-ready-*.marker
    rm -f "$TEST_OUTPUT"
}

trap cleanup EXIT

echo "Test 1: Create a screen session with a long-running command"
screen -dmS "$SESSION_NAME" bash
sleep 0.5

# Send a long-running command that outputs lines containing prompt-like characters
echo "Sending a long-running command (sleep 3 with output)..."
screen -S "$SESSION_NAME" -X stuff 'echo "Processing... $"; sleep 3; echo "Done processing >"\n'

sleep 0.5

echo ""
echo "Test 2: Try to detect readiness while command is running (should fail)"
echo "Attempting marker-based readiness check..."

MARKER_FILE="/tmp/screen-ready-test-$$.marker"
screen -S "$SESSION_NAME" -X stuff "touch $MARKER_FILE 2>/dev/null\n"

# Check if marker appears within 1 second
READY=false
for i in {1..10}; do
    sleep 0.1
    if [ -f "$MARKER_FILE" ]; then
        READY=true
        break
    fi
done

if [ "$READY" = "true" ]; then
    echo "✗ FAIL: Session reported as ready while command was running"
    rm -f "$MARKER_FILE"
    exit 1
else
    echo "✓ PASS: Session correctly detected as busy"
fi

echo ""
echo "Test 3: Wait for command to complete, then check readiness again"
echo "Waiting for command to finish..."
sleep 3

echo "Checking readiness after command completion..."
MARKER_FILE="/tmp/screen-ready-test2-$$.marker"
screen -S "$SESSION_NAME" -X stuff "touch $MARKER_FILE 2>/dev/null\n"

# Check if marker appears within 1 second
READY=false
for i in {1..10}; do
    sleep 0.1
    if [ -f "$MARKER_FILE" ]; then
        READY=true
        break
    fi
done

if [ "$READY" = "true" ]; then
    echo "✓ PASS: Session correctly detected as ready"
    rm -f "$MARKER_FILE"
else
    echo "✗ FAIL: Session not detected as ready when it should be"
    exit 1
fi

echo ""
echo "Test 4: Simulate concurrent command execution"
echo "Sending first command..."
screen -S "$SESSION_NAME" -X stuff 'sleep 2; echo "First command done" > '"$TEST_OUTPUT"'\n'

sleep 0.2

echo "Immediately trying to send second command (checking readiness first)..."
MARKER_FILE="/tmp/screen-ready-test3-$$.marker"
screen -S "$SESSION_NAME" -X stuff "touch $MARKER_FILE 2>/dev/null\n"

# Check if marker appears within 0.5 second
READY=false
for i in {1..5}; do
    sleep 0.1
    if [ -f "$MARKER_FILE" ]; then
        READY=true
        break
    fi
done

if [ "$READY" = "true" ]; then
    echo "✗ FAIL: Session falsely reported as ready during concurrent execution"
    rm -f "$MARKER_FILE"
    exit 1
else
    echo "✓ PASS: Session correctly detected as busy during concurrent execution"
fi

echo ""
echo "Waiting for first command to complete..."
sleep 2.5

echo "Now checking readiness again..."
MARKER_FILE="/tmp/screen-ready-test4-$$.marker"
screen -S "$SESSION_NAME" -X stuff "touch $MARKER_FILE 2>/dev/null\n"

READY=false
for i in {1..10}; do
    sleep 0.1
    if [ -f "$MARKER_FILE" ]; then
        READY=true
        break
    fi
done

if [ "$READY" = "true" ]; then
    echo "✓ PASS: Session ready after first command completed"
    rm -f "$MARKER_FILE"
else
    echo "✗ FAIL: Session should be ready now"
    exit 1
fi

echo ""
echo "=== All Tests Passed! ==="
echo ""
echo "Summary:"
echo "  ✓ Correctly detects busy state during command execution"
echo "  ✓ Correctly detects ready state after command completion"
echo "  ✓ Prevents false 'ready' reports during concurrent execution"
echo ""
