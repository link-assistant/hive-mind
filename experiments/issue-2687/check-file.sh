#!/usr/bin/env bash
# Run inside a task image to verify the attachment prerequisite.
set -eu
command -v file
file --version
file --mime-type docs/case-studies/issue-2687/data/related-issue-2591.png
