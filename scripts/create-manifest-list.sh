#!/usr/bin/env bash
# create-manifest-list.sh
#
# Push the multi-platform manifest list for one image, from the per-platform
# digests the matrix builds uploaded as artifacts.
#
# Why this is a script (issue #2198):
#   The same six lines were inlined in four jobs of release.yml, and each copy
#   built the `docker buildx imagetools create` argument list through unquoted
#   command substitution:
#
#     docker buildx imagetools create $(jq -cr '.tags | map("-t " + .) | join(" ")' ...) \
#       $(printf '<image>@sha256:%s ' *)
#
#   The word splitting was intentional, but shellcheck cannot tell that apart
#   from a bug (SC2046), so the whole release workflow could not pass actionlint
#   — see .github/workflows/workflows.yml. Building an explicit array says the
#   same thing without relying on splitting, and one copy can be tested.
#
# Usage:
#   IMAGE_NAME=owner/image DIGESTS_DIR=/tmp/digests bash scripts/create-manifest-list.sh
#
# Environment:
#   IMAGE_NAME                   Required. Image repository the digests belong to.
#   DIGESTS_DIR                  Directory of digest files, one per platform, each
#                                named after the digest without the "sha256:"
#                                prefix. Default: /tmp/digests
#   DOCKER_METADATA_OUTPUT_JSON  Required. Exported by docker/metadata-action;
#                                its `.tags` become the -t arguments.
#   DRY_RUN                      When "true", print the command instead of running
#                                it. Used by tests/test-issue-2198-manifest-list.mjs.

set -euo pipefail

: "${IMAGE_NAME:?IMAGE_NAME is required}"
: "${DOCKER_METADATA_OUTPUT_JSON:?DOCKER_METADATA_OUTPUT_JSON is required (exported by docker/metadata-action)}"
DIGESTS_DIR="${DIGESTS_DIR:-/tmp/digests}"
DRY_RUN="${DRY_RUN:-false}"

echo "Creating multi-platform manifest for ${IMAGE_NAME}..."

args=()

# -t per tag. The tags are read one per line, so a tag containing a space or a
# shell metacharacter still arrives as a single argument. Node rather than jq
# for the same reason as scripts/check-pipeline-status.sh: node is guaranteed
# present wherever this repository's CI runs, jq is not.
while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  args+=(-t "$tag")
done < <(node --input-type=module -e '
  const metadata = JSON.parse(process.env.DOCKER_METADATA_OUTPUT_JSON);
  for (const tag of metadata.tags ?? []) console.log(tag);
')

if [ "${#args[@]}" -eq 0 ]; then
  echo "::error::No tags in DOCKER_METADATA_OUTPUT_JSON — refusing to create an untagged manifest list"
  exit 1
fi

# One source reference per uploaded digest file.
sources=()
for digest_file in "$DIGESTS_DIR"/*; do
  [ -f "$digest_file" ] || continue
  sources+=("${IMAGE_NAME}@sha256:$(basename "$digest_file")")
done

if [ "${#sources[@]}" -eq 0 ]; then
  echo "::error::No digest files in ${DIGESTS_DIR} — the per-platform builds uploaded nothing to merge"
  exit 1
fi

echo "Tags:    ${args[*]}"
echo "Digests: ${sources[*]}"

if [ "$DRY_RUN" = "true" ]; then
  printf 'docker buildx imagetools create'
  printf ' %s' "${args[@]}" "${sources[@]}"
  printf '\n'
  exit 0
fi

docker buildx imagetools create "${args[@]}" "${sources[@]}"
