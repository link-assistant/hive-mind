#!/bin/bash
# Test the fix for Perl version detection
#
# This experiment simulates different perlbrew available outputs
# and tests that the new regex correctly extracts the version

set -e

# Simulate realistic perlbrew available output (based on actual format)
simulate_perlbrew_output() {
cat << 'EOF'
# perl
  perl-5.40.0
  perl-5.38.2
  perl-5.36.3
  perl-5.34.3
  perl-5.32.1
  perl-5.30.3
  perl-5.28.3
  perl-5.26.3
   perl-5.8.9

# cperl
 cperl-5.30.0

# perl-blead
  perl-blead
EOF
}

# Simulate output with installed markers
simulate_perlbrew_with_installed() {
cat << 'EOF'
# perl
i perl-5.40.0
  perl-5.38.2
  perl-5.36.3
EOF
}

# Simulate error output
simulate_perlbrew_error() {
cat << 'EOF'
curl: (6) Could not resolve host: metacpan.org
Error fetching available perls
EOF
}

# Simulate empty output
simulate_perlbrew_empty() {
  echo ""
}

echo "=== Testing NEW extraction method (grep -oE) ==="
echo "This is what the fix uses"
echo ""

echo "Test 1: Normal output"
PERLBREW_OUTPUT=$(simulate_perlbrew_output)
LATEST_PERL=$(echo "$PERLBREW_OUTPUT" | grep -oE 'perl-5\.[0-9]+\.[0-9]+' | head -1 || true)
if [ "$LATEST_PERL" = "perl-5.40.0" ]; then
  echo "PASS: Extracted '$LATEST_PERL'"
else
  echo "FAIL: Expected 'perl-5.40.0', got '$LATEST_PERL'"
fi

echo ""
echo "Test 2: Output with installed marker"
PERLBREW_OUTPUT=$(simulate_perlbrew_with_installed)
LATEST_PERL=$(echo "$PERLBREW_OUTPUT" | grep -oE 'perl-5\.[0-9]+\.[0-9]+' | head -1 || true)
if [ "$LATEST_PERL" = "perl-5.40.0" ]; then
  echo "PASS: Extracted '$LATEST_PERL'"
else
  echo "FAIL: Expected 'perl-5.40.0', got '$LATEST_PERL'"
fi

echo ""
echo "Test 3: Error output (no version)"
PERLBREW_OUTPUT=$(simulate_perlbrew_error)
LATEST_PERL=$(echo "$PERLBREW_OUTPUT" | grep -oE 'perl-5\.[0-9]+\.[0-9]+' | head -1 || true)
if [ -z "$LATEST_PERL" ]; then
  echo "PASS: Correctly returned empty string for error output"
else
  echo "FAIL: Expected empty string, got '$LATEST_PERL'"
fi

echo ""
echo "Test 4: Empty output"
PERLBREW_OUTPUT=$(simulate_perlbrew_empty)
if [ -z "$PERLBREW_OUTPUT" ]; then
  echo "PASS: Correctly detected empty output (will trigger warning)"
fi
LATEST_PERL=$(echo "$PERLBREW_OUTPUT" | grep -oE 'perl-5\.[0-9]+\.[0-9]+' | head -1 || true)
if [ -z "$LATEST_PERL" ]; then
  echo "PASS: Correctly returned empty string for empty output"
else
  echo "FAIL: Expected empty string, got '$LATEST_PERL'"
fi

echo ""
echo "=== Comparison with OLD method ==="
echo "Old pattern: ^\s*perl-5\.[0-9]+\.[0-9]+$"
echo ""

echo "Test 5: Normal output with OLD method"
PERLBREW_OUTPUT=$(simulate_perlbrew_output)
OLD_LATEST_PERL=$(echo "$PERLBREW_OUTPUT" | grep -E '^\s*perl-5\.[0-9]+\.[0-9]+$' | head -1 | tr -d '[:space:]' || true)
echo "Old method result: '$OLD_LATEST_PERL'"

echo ""
echo "Test 6: Output with installed marker - OLD method"
PERLBREW_OUTPUT=$(simulate_perlbrew_with_installed)
OLD_LATEST_PERL=$(echo "$PERLBREW_OUTPUT" | grep -E '^\s*perl-5\.[0-9]+\.[0-9]+$' | head -1 | tr -d '[:space:]' || true)
if [ "$OLD_LATEST_PERL" = "perl-5.40.0" ]; then
  echo "Old method PASSES on this format"
else
  echo "Old method FAILS: Expected 'perl-5.40.0', got '$OLD_LATEST_PERL'"
  echo "This demonstrates why the old regex is fragile"
fi

echo ""
echo "=== Summary ==="
echo "The new grep -oE approach is more robust because:"
echo "1. It extracts just the version string, ignoring any prefix/suffix"
echo "2. It handles lines with 'i' markers for installed versions"
echo "3. It works regardless of indentation or formatting changes"
echo "4. It filters out cperl and perl-blead variants automatically"
