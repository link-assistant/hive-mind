# google/ax at d0bc38bcf90bb2ad9c012ff1be9d68ff05347ba9 (2026-09-25)

## Tags
v0.1.0 2026-05-19
v0.2.0 2026-07-20
v0.2.1 2026-07-22
v0.2.2 2026-07-22
v0.2.3 2026-08-13
v0.3.0 2026-09-19
v0.3.1 2026-09-25

## Commit count: 641

## Top contributors
   375	Jaana Dogan
   105	JBD
    45	Junjie Wang
    43	JoyceLiu
    30	anj-s
    13	Joyce Liu
    12	zbl94
     3	Dmitry Berkovich
     3	ktsoator
     2	Hyang-Ah Hana Kim

## Pivot commits
dc4f36c 2026-09-19 Restructure AX into a general-purpose orchestration layer for agentic tasks
0b5427c 2026-09-24 Remove Gateway concept to avoid bifurcation with Substrate (#395)

## Go/Python source line count (internal, runner, cmd)
  8051 total

## Files
.dockerignore
.github/workflows/check-binaries.yml
.github/workflows/go.yml
.gitignore
.ko.yaml
CONTRIBUTING.md
DESIGN.md
Dockerfile.task-runner
LICENSE
Makefile
README.md
assets/axolotl-mono.svg
assets/axolotl.svg
cmd/ax-controller/main.go
cmd/ax-server/main.go
cmd/ax-task-runner/antigravity_bootstrap.py
cmd/ax-task-runner/main.go
cmd/ax/apply_test.go
cmd/ax/main.go
cmd/ax/main_test.go
demo.sh
deploy/ax-controller.yaml
deploy/ax-server.yaml
deploy/redis.yaml
docs/concepts.md
docs/development.md
docs/logo.md
docs/manifests.md
docs/networking.md
docs/roadmap.md
docs/runner.md
docs/sandbox.md
examples/simple.yaml
examples/task.yaml
go.mod
go.sum
internal/controller/reconciler.go
internal/controller/reconciler_test.go
internal/controller/worker.go
internal/controller/worker_test.go
internal/guest/client.go
internal/metadata/server.go
internal/metadata/server_test.go
internal/model/client.go
internal/model/client_test.go
internal/server/server.go
internal/server/server_test.go
internal/store/memory/store.go
internal/store/redis/store.go
internal/store/store.go
internal/substrate/client.go
internal/tunnel/context.go
internal/tunnel/tunnel.go
internal/tunnel/tunnel_test.go
internal/workspace/planner.go
internal/workspace/planner_test.go
internal/workspace/setup.go
internal/workspace/setup_test.go
pkg/apis/v1alpha1/ax.pb.go
pkg/apis/v1alpha1/ax.proto
pkg/apis/v1alpha1/ax_grpc.pb.go
pkg/apis/v1alpha1/types.go
pkg/apis/v1alpha1/types_test.go
runner/runner.go
runner/runner_test.go
