# Allow Docker-isolated sessions to join named networks

## Downstream use case

[`link-assistant/hive-mind#2146`](https://github.com/link-assistant/hive-mind/issues/2146) requires an agent task container to reach an on-demand Formal AI sidecar only through a private Docker network. The sidecar and task run in the same Docker daemon; unrelated task containers must not join that network.

Hive Mind launches detached task containers through start-command's native Docker isolation backend and uses a startup gate before the task command begins. start-command 0.30.3 can pass environment variables, volumes, mounts, and privileged mode, but it cannot select a Docker network or network alias.

## Reproduction

```bash
docker network create --internal hive-formal-ai
$ --isolated docker \
  --image alpine:3.23 \
  --network hive-formal-ai \
  -- echo ok
```

Actual result with start-command 0.30.3:

```text
Error: Unknown wrapper option: --network
```

`src/lib/isolation.js`'s `buildDockerRuntimeArgs` currently emits only `--privileged`, `-e`, `-v`, and `--mount` runtime arguments.

## Workaround

Launch the detached session behind an application-level startup gate, find its container by the session UUID, run:

```bash
docker network connect hive-formal-ai "$SESSION_UUID"
```

and release the gate only after the connect succeeds. Disconnect/remove the container at completion. This is viable for Hive Mind but requires downstream lifecycle code and leaves a race for callers that do not already gate their task command.

## Suggested implementation

Add repeatable wrapper options such as:

```text
--network <name>
--network-alias <alias>
```

For the ordinary one-network case, emit `docker run --network <name>` and one or more `--network-alias` arguments before the image. If multiple networks are supported, create the container on the first network and connect the remaining networks before starting it so the user command cannot race the network setup.

The selected networks and aliases should also appear in start-command's human-readable isolation status and execution-record metadata, matching the existing env/volume/mount/privileged behavior.

## Acceptance tests

- Parser tests accept `--network value`, `--network=value`, and repeatable aliases without consuming child-command arguments after `--`.
- `buildDockerRuntimeArgs` emits stable Docker argv ordering before the image.
- Status and JSON execution metadata record networks and aliases.
- An integration test creates an `--internal` network, starts two containers on it, resolves one by alias, and proves an unconnected control container cannot resolve that alias.
- Detached mode does not release the child command before every requested network attachment succeeds.
- A missing network produces a non-zero launch failure and no orphaned running container.

This feature is not a blocker for Hive Mind because its existing startup gate permits the explicit `docker network connect` workaround, but native support would make the isolation contract complete and race-free for other callers.
