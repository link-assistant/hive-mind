/**
 * The `docker ps` output format every container listing uses (issue #3000).
 *
 * `docker ps --format '{{json .}}'` makes dockerd compute the size of every
 * container: the CLI executes the template once against a probe, sees `.Size`
 * referenced (`{{json .}}` references every field) and adds `size=1` to the
 * request. Dockerd then walks each container's writable layer
 * (`snapshotter.Usage` on the containerd image store). On the production host
 * that turned a 0.35 s listing into a 2.5 s one, and it failed outright when a
 * task deleted a file mid-walk:
 *
 *   Error response from daemon: snapshotter.Usage failed for 698e6ba296d2…:
 *   lstat …/snapshots/7214/fs/tmp/ccCBKh2I.s: no such file or directory
 *
 * Naming the fields the callers read keeps the output JSON lines (so the
 * existing parsers work unchanged) and never requests sizes. Add a field here
 * only if a parser needs it — and never `Size`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3000
 */

/** The `docker ps` fields container parsers read. `Size` must never be added. */
export const DOCKER_PS_FIELDS = Object.freeze(['ID', 'Names', 'Image', 'State', 'Status', 'Labels']);

/** `{"A":{{json .A}},"B":{{json .B}}}` — one JSON object per line, like `{{json .}}`. */
export function buildDockerJsonFormat(fields) {
  return `{${fields.map(field => `"${field}":{{json .${field}}}`).join(',')}}`;
}

export const DOCKER_PS_JSON_FORMAT = buildDockerJsonFormat(DOCKER_PS_FIELDS);

/** Arguments for `docker ps` over every container, without the size walk. */
export function dockerPsArgs({ all = true } = {}) {
  return ['ps', ...(all ? ['--all'] : []), '--format', DOCKER_PS_JSON_FORMAT];
}

export default {
  DOCKER_PS_FIELDS,
  DOCKER_PS_JSON_FORMAT,
  buildDockerJsonFormat,
  dockerPsArgs,
};
