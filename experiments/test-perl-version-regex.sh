#!/bin/bash
# Experiment: Test regex patterns for parsing perlbrew available output
#
# Based on perlbrew source code, the output format is:
# printf "%1s %12s  %s %s\n", indicator, version, status, url
#
# Example lines:
# "i   perl-5.32.0  INSTALLED on ..." (installed version)
# "    perl-5.30.3  available from ..." (available version)
# Without verbose mode:
# "i   perl-5.32.0"
# "    perl-5.30.3"
#
# The version field is 12 characters wide and right-aligned.
# There might also be section headers like:
# "perl-blead" for development versions
# "cperl-5.30.0" for cperl variants
# etc.

# Simulate various perlbrew available output formats
simulate_perlbrew_output() {
cat << 'EOF'
# perl

  perl-5.40.0
  perl-5.38.2
  perl-5.36.3
  perl-5.34.3
  perl-5.32.1
  perl-5.30.3

# cperl

 cperl-5.30.0

# perl-blead

  perl-blead
EOF
}

# Simulate with 'i' markers for installed versions
simulate_perlbrew_output_with_installed() {
cat << 'EOF'
# perl

i perl-5.40.0
  perl-5.38.2
  perl-5.36.3
  perl-5.34.3
  perl-5.32.1
  perl-5.30.3

# cperl

 cperl-5.30.0

# perl-blead

  perl-blead
EOF
}

echo "=== Testing current regex (broken) ==="
echo "Pattern: ^\s*perl-5\.[0-9]+\.[0-9]+$"
echo ""
CURRENT_REGEX='^\s*perl-5\.[0-9]+\.[0-9]+$'
RESULT=$(simulate_perlbrew_output | grep -E "$CURRENT_REGEX" | head -1 | tr -d '[:space:]')
echo "Result with current regex: '$RESULT'"
echo ""

echo "=== Testing improved regex ==="
# The improved regex should:
# 1. Allow for an optional 'i' marker at the start
# 2. Allow for whitespace before the version
# 3. Match perl-5.X.Y format (stable versions only, even minor version numbers)
# 4. Not match cperl, perl-blead, or development versions

echo "Pattern: ^[i ]?\s*perl-5\.[0-9]+\.[0-9]+$"
IMPROVED_REGEX='^[i ]?\s*perl-5\.[0-9]+\.[0-9]+$'
echo ""
echo "Matching lines:"
simulate_perlbrew_output | grep -E "$IMPROVED_REGEX"
echo ""
RESULT=$(simulate_perlbrew_output | grep -E "$IMPROVED_REGEX" | head -1 | tr -d '[:space:]')
echo "First result: '$RESULT'"
echo ""

echo "=== Testing with installed markers ==="
echo "Matching lines:"
simulate_perlbrew_output_with_installed | grep -E "$IMPROVED_REGEX"
echo ""
RESULT=$(simulate_perlbrew_output_with_installed | grep -E "$IMPROVED_REGEX" | head -1 | tr -d '[:space:]')
echo "First result: '$RESULT'"
echo ""

echo "=== Testing more flexible extraction ==="
# Even more flexible: just extract the perl-5.X.Y pattern anywhere on the line
echo "Pattern: perl-5\.[0-9]+\.[0-9]+"
FLEXIBLE_REGEX='perl-5\.[0-9]+\.[0-9]+'
echo ""
echo "Matching lines (with grep -oE to extract just the version):"
simulate_perlbrew_output | grep -oE "$FLEXIBLE_REGEX" | head -5
echo ""
RESULT=$(simulate_perlbrew_output | grep -oE "$FLEXIBLE_REGEX" | head -1)
echo "First extracted version: '$RESULT'"
echo ""

echo "=== Recommended fix ==="
echo "Use: grep -oE 'perl-5\\.[0-9]+\\.[0-9]+' to extract the version string directly"
echo "This is more robust than matching the entire line format"
