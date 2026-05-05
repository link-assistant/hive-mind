#!/bin/bash
# Experiment 01: Basic stream-json input test
# This tests if claude can receive input in stream-json format via stdin

echo "=== Experiment 01: Basic Stream-JSON Input ==="
echo "Testing --input-format stream-json with a single user message"
echo ""

# Create a simple user message in the expected stream-json format
echo '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Say hello in exactly 5 words"}]}}' | \
  claude -p --output-format=stream-json --input-format=stream-json --verbose 2>&1 | head -50

echo ""
echo "=== Test Complete ==="
