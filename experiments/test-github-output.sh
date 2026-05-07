#!/bin/bash
# Simulate GitHub Actions output mechanism
# The issue might be related to how outputs are written and read

# Create a temp file simulating GITHUB_OUTPUT
GITHUB_OUTPUT=$(mktemp)
echo "Simulated GITHUB_OUTPUT file: $GITHUB_OUTPUT"

# Simulate the "Set publish outputs" step
echo "published=true" >> $GITHUB_OUTPUT
echo "published_version=0.51.2" >> $GITHUB_OUTPUT

# Read back the outputs
echo "Contents of GITHUB_OUTPUT:"
cat $GITHUB_OUTPUT

# Simulate reading the output (like GitHub Actions would)
while IFS='=' read -r key value; do
    echo "Key: $key, Value: $value"
    if [ "$key" = "published" ] && [ "$value" = "true" ]; then
        echo "Condition 'published == true' would be TRUE"
    fi
done < $GITHUB_OUTPUT

rm $GITHUB_OUTPUT
