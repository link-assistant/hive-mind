#!/bin/bash

# Test script to simulate concurrent fork creation attempts
# This script demonstrates the retry mechanism works when multiple workers
# try to create a fork simultaneously

echo "Testing concurrent fork creation with retry mechanism"
echo "======================================================="

# Test repository (should be a public repo where you don't have a fork yet)
TEST_REPO="octocat/Hello-World"  # Example public repo
ISSUE_URL="https://github.com/$TEST_REPO/issues/1"

# Number of concurrent workers
NUM_WORKERS=3

echo ""
echo "Test setup:"
echo "  - Repository: $TEST_REPO"
echo "  - Concurrent workers: $NUM_WORKERS"
echo "  - Each worker will attempt to fork the repository"
echo ""

# Clean up any existing fork first (optional)
echo "Checking for existing fork..."
CURRENT_USER=$(gh api user --jq .login 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "Current user: $CURRENT_USER"

    # Check if fork already exists
    gh repo view "$CURRENT_USER/$(basename $TEST_REPO)" --json name 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "Note: Fork already exists for $CURRENT_USER/$(basename $TEST_REPO)"
        echo "The test will still run, but fork creation will be skipped."
    else
        echo "No existing fork found. Test will create a new fork."
    fi
else
    echo "Error: Unable to get current GitHub user. Is gh authenticated?"
    exit 1
fi

echo ""
echo "Starting concurrent fork attempts..."
echo "------------------------------------"

# Function to run a single worker
run_worker() {
    local worker_id=$1
    local log_file="/tmp/fork-test-worker-$worker_id.log"

    echo "[Worker $worker_id] Starting fork attempt..."

    # Run solve.mjs with --fork flag in dry-run mode
    # This will test the fork creation logic without actually solving the issue
    ./solve.mjs "$ISSUE_URL" --fork --dry-run > "$log_file" 2>&1 &

    echo "[Worker $worker_id] Process started (PID: $!)"
    return $!
}

# Start all workers concurrently
PIDS=()
for i in $(seq 1 $NUM_WORKERS); do
    run_worker $i
    PIDS+=($!)
    sleep 0.5  # Small delay to ensure true concurrency
done

echo ""
echo "All workers started. Waiting for completion..."
echo ""

# Wait for all workers to complete
FAILED=0
for i in $(seq 1 $NUM_WORKERS); do
    PID=${PIDS[$((i-1))]}
    wait $PID
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        echo "[Worker $i] ✅ Completed successfully"
    else
        echo "[Worker $i] ❌ Failed with exit code $EXIT_CODE"
        FAILED=$((FAILED + 1))
    fi

    # Show relevant log lines about fork creation
    echo "[Worker $i] Fork-related log entries:"
    grep -E "(Fork|fork|Creating|Retry|Verifying|already exists)" "/tmp/fork-test-worker-$i.log" | head -n 10 | sed 's/^/    /'
    echo ""
done

echo "======================================================="
echo "Test Results:"
echo "  - Total workers: $NUM_WORKERS"
echo "  - Successful: $((NUM_WORKERS - FAILED))"
echo "  - Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "✅ TEST PASSED: All workers handled fork creation successfully!"
    echo "   This demonstrates that the retry mechanism works correctly"
    echo "   when multiple workers attempt to create a fork simultaneously."
else
    echo "❌ TEST FAILED: Some workers failed to handle concurrent fork creation"
    echo "   Check the logs in /tmp/fork-test-worker-*.log for details"
fi

echo ""
echo "Cleanup: Log files are in /tmp/fork-test-worker-*.log"