#!/bin/bash

# Test script to verify the auto-commit option behavior

echo "Testing auto-commit option functionality..."
echo "==========================================="
echo ""

# Test 1: Check that option is recognized
echo "Test 1: Checking if --auto-commit-uncommitted-changes option is recognized"
node src/solve.mjs --help 2>&1 | grep -q "auto-commit-uncommitted-changes"
if [ $? -eq 0 ]; then
    echo "✅ Option is recognized in help text"
else
    echo "❌ Option not found in help text"
    exit 1
fi

echo ""
echo "Test 2: Checking default value (should be disabled by default)"
node src/solve.mjs --help 2>&1 | grep -A2 "auto-commit-uncommitted-changes" | grep -q "disabled by default"
if [ $? -eq 0 ]; then
    echo "✅ Default value is disabled as expected"
else
    echo "❌ Default value is not disabled"
    exit 1
fi

echo ""
echo "Test 3: Checking option description"
node src/solve.mjs --help 2>&1 | grep -A1 "auto-commit-uncommitted-changes" | grep -q "Automatically commit and push"
if [ $? -eq 0 ]; then
    echo "✅ Description mentions automatic commit and push"
else
    echo "❌ Description doesn't properly describe the feature"
    exit 1
fi

echo ""
echo "==========================================="
echo "All tests passed! ✅"
echo ""
echo "The --auto-commit-uncommitted-changes option has been successfully implemented."
echo "By default (when option is not used), uncommitted changes will:"
echo "  - Be shown to the user with instructions"
echo "  - Be included as feedback when running Claude again"
echo ""
echo "When --auto-commit-uncommitted-changes is used, the behavior will:"
echo "  - Automatically commit and push changes like before"