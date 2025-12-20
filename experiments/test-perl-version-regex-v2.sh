#!/bin/bash
# Experiment v2: Test regex patterns for parsing perlbrew available output
# Including section headers that might interfere

# More realistic simulation based on actual perlbrew output
simulate_perlbrew_output_realistic() {
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
  perl-5.24.4
  perl-5.22.4
  perl-5.20.3
  perl-5.18.4
  perl-5.16.3
  perl-5.14.4
  perl-5.12.5
  perl-5.10.1
   perl-5.8.9
   perl-5.6.2

# cperl
 cperl-5.30.0
 cperl-5.29.2
 cperl-5.29.1
 cperl-5.29.0

# perl-blead
  perl-blead
EOF
}

echo "=== Testing current script logic exactly as-is ==="
LATEST_PERL=$(simulate_perlbrew_output_realistic 2>/dev/null | grep -E '^\s*perl-5\.[0-9]+\.[0-9]+$' | head -1 | tr -d '[:space:]' || true)
echo "Result: '$LATEST_PERL'"
if [ -n "$LATEST_PERL" ]; then
    echo "SUCCESS: Version detected"
else
    echo "FAILURE: Could not determine latest Perl version"
fi
echo ""

echo "=== The issue: section headers and variable indentation ==="
echo "Output lines from simulation:"
simulate_perlbrew_output_realistic | head -10
echo ""
echo "Lines matching current regex:"
simulate_perlbrew_output_realistic | grep -E '^\s*perl-5\.[0-9]+\.[0-9]+$'
echo ""

echo "=== Testing grep -oE approach (more robust) ==="
LATEST_PERL_NEW=$(simulate_perlbrew_output_realistic 2>/dev/null | grep -oE 'perl-5\.[0-9]+\.[0-9]+' | head -1 || true)
echo "Result: '$LATEST_PERL_NEW'"
if [ -n "$LATEST_PERL_NEW" ]; then
    echo "SUCCESS: Version detected"
else
    echo "FAILURE: Could not determine latest Perl version"
fi
echo ""

echo "=== Testing with empty output (network error simulation) ==="
LATEST_PERL_EMPTY=$(echo "" 2>/dev/null | grep -E '^\s*perl-5\.[0-9]+\.[0-9]+$' | head -1 | tr -d '[:space:]' || true)
echo "Result with empty input: '$LATEST_PERL_EMPTY'"
if [ -n "$LATEST_PERL_EMPTY" ]; then
    echo "SUCCESS: Version detected"
else
    echo "FAILURE: Could not determine latest Perl version (expected for empty input)"
fi
echo ""

echo "=== Testing with error output only ==="
# When perlbrew has issues, it might output to stderr only
LATEST_PERL_ERROR=$( { echo "Error: could not fetch available perls" >&2; } 2>/dev/null | grep -E '^\s*perl-5\.[0-9]+\.[0-9]+$' | head -1 | tr -d '[:space:]' || true)
echo "Result with error-only input: '$LATEST_PERL_ERROR'"
echo ""

echo "=== CONCLUSION ==="
echo "The current regex works in our simulation, but the actual perlbrew"
echo "output may differ. Possible causes of failure in CI:"
echo "1. Network issues fetching available versions"
echo "2. Different output format in perlbrew version used"
echo "3. stderr being discarded but no stdout produced"
echo ""
echo "Recommended fix: Use grep -oE 'perl-5\\.[0-9]+\\.[0-9]+' for more robust extraction"
echo "Also add error handling to show what perlbrew actually outputs on failure"
