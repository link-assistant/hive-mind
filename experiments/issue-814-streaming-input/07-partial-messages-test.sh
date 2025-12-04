#!/bin/bash
# Experiment 07: Test --include-partial-messages flag
# This flag includes partial streaming events as they arrive

echo "=== Experiment 07: Testing --include-partial-messages ==="
echo "This flag should show partial message chunks as they stream"
echo ""

# Test with include-partial-messages flag
echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Count from 1 to 10 slowly, one number per line"}]}}' | \
  claude -p \
  --output-format=stream-json \
  --input-format=stream-json \
  --include-partial-messages \
  --verbose 2>&1 | head -100

echo ""
echo "=== Test Complete ==="
