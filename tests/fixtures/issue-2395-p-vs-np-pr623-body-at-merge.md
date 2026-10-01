## Scope

This is the first PR-sized slice of #567's N1 circuit verifier milestone, plus a scoped adversarial claim for #568. It does not establish `CircuitSATInNP` or P ≠ NP.

**Known theorem mechanized:** Lean now decodes the exact `encCircuit` format, rejects malformed or trailing bits, and checks wire well-formedness. Lean and Rocq both validate certificate length and evaluate the NAND circuit. `circuitSAT_iff_verifyCircuit` proves that an accepted certificate is exactly a witness for the existing `CircuitSAT` language. The paired data-size lemmas bound decoded input/gate counts, certificate length, and evaluator wire-list length.

**Scoped algorithmic counterexample:** For every `k`, `satFamily k` and `unsatFamily k` have the same `(numVars, clause count, encoded bit length)` key and opposite satisfiability. Both have `k + 2` clauses and encoded length `4 * (k + 2)`. Thus a cache using only that coarse key cannot safely reuse SAT answers. This is a counterexample to that specified key, not to a full residual-formula key or an unrestricted SAT solver.

## Reproduction and checks

Before the fix, `experiments/issue567/DecoderRegression.lean` failed to elaborate because Lean had no executable `decCircuit`. The paired regression files now check round trips, malformed and trailing encodings, forward wires, the zero-input convention, accepted and rejected NAND certificates, and wrong certificate lengths.

- `lake build` and `make -f Makefile.coq`
- `lake env lean experiments/issue567/DecoderRegression.lean`
- `make -f Makefile.coq experiments/issue567/DecoderRegression.vo`
- `python3 scripts/check_proof_status.py` with `--lean` and `--rocq`
- The repository's Lean and Rocq workflow checks

[Formal Verification Suite](https://github.com/konard/p-vs-np/actions/runs/36623953752) passed all seven jobs on commit `e829f09`.

The public theorem assumption queries are in `experiments/issue567/Assumptions.lean` and `.v`; the CI certified jobs build both new proof modules before running the enforced audit.

## Remaining premises

The verifier is a finite function in the prover, but no `Complexity.Machine` implements it on `pairedInput`, and no polynomial `Run` or clocked termination proof is supplied. `CircuitSATInNP` remains an explicit theorem argument. Other relevant premises, including `PSubsetPPoly`, `SATHard` for the converse clocked-SAT bridge, and the Williams/hierarchy premises, remain explicit. This PR removes none of them.

Refs #567 and #568.
