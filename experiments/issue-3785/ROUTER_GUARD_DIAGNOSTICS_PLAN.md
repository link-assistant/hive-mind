# Router guard diagnostic failures

- [x] Reproduce synchronous and asynchronous diagnostic failures in isolated,
      finite Node children with 32 MiB heaps and five-second child deadlines.
- [x] Cover initial arm logging and throwing/rejecting violation handlers with
      both diagnostic failure modes. All six before controls fail; preserve
      their actual stack traces and paired security decisions.
- [x] Commit the preceding four-adapter lifetime repair after its default suite.
- [x] Make diagnostics best effort and independent of cancellation; capture
      synchronous stop-handler exceptions inside the handled promise chain.
- [x] Retain the first violation and one handler invocation despite logger or
      handler failure. Verify no unhandled child rejection and no leaked timers.
- [x] Add a default-suite wrapper, run affected guard/admission/lifetime tests
      and required quality checks, then record evidence and commit.
- [x] Include the new wrapper in the complete combined default suite before
      the next authorized push.

This repairs the guard's diagnostic error path. It does not establish native
request authority, successful cancellation after a broken native kill operation,
or the complete Router audit and lifecycle contract.
