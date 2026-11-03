# Atomic native publication proofs

Stage 27 of the disposable Gemini CLI 0.65.0 experiment repairs a smaller crash
boundary left open by stage 26. Production installation and A9 remain unfinished.

The preceding helper creates its visible `.publish-UUID.json` before writing
JSON. A finite Linux interposer lets the real native CLI write and synchronize
half of that small proof, then sends SIGKILL. Both first and replacement Plan
Mode writes reproduce a permanently refused fresh resume after whole private-home
disposal. The first document stays absent; replacement retains the preceding
complete document and generation. Neither interrupted call was acknowledged.

The repair writes the proof into an exclusive, checked temporary file first.
It retains its opened descriptor identity before synchronization, verifies the
complete bytes and publishes the complete proof using an exclusive hard link.
Recovery admits its temporary second link only when the exact expected alias has
the same checked identity and generation. It validates the proof schema, staged
data and existing target before removing that alias, then checks the full proof
bytes and identity again. Every other extra link or unsafe proof still refuses.
The preceding data publication and plan transaction recovery remain in place.

After a partial temporary proof write, the same canonical session can resume in
a fresh complete native CLI. A real `write_file` retry then publishes the complete
plan; a real `read_file` delivers every UTF-8 line to the provider. Full preceding
audits and generations remain retained. Incomplete unreferenced temporary files
remain untouched; this stage does not claim to clean them automatically.

Run the strict-before/repair/after driver on the exact stage-26 package:

```sh
bash experiments/issue-3785/native-gemini/check_atomic_publication.sh "$package" /tmp/gemini-atomic-proof
```

The bounded native API suite separately kills owners immediately after linking
the complete proof and after removing its alias. Fresh processes recover registry,
prompt history, checkpoints, tool artifacts, blobs, first plans and replacement
plans after deleting the whole private home: fourteen cases, 28 assertions.
Thirteen unsafe alias/proof/data cases require sticky refusal without changing
any canonical or protected identity or byte. Two live controls replace the
proof's inode with identical bytes or change bytes in the same inode during
synchronization; both must refuse before visible proof or data publication.

The driver also repeats the earlier generic publication boundaries and unsafe
controls under exact stage-27 pins, complete plan transaction/storage suites,
six synchronized whole-CLI boundaries, both partial-write retries, and selected
and unselected ordinary CLI plan controls. The preceding suites keep their own
original pins and strict before failures. Fresh reconstruction selects
`--atomic-proofs` in addition to `--plan-transactions` and compares seventeen
native files across all twenty-seven stages.

Physical power loss, unreferenced staging cleanup, durable fresh-process rollback
authority, remaining filesystem writers/task memory and full production lifecycle
remain open. A retry before acknowledgement is required at the partial-write
boundary; the experiment does not infer an unpublished plan from an incomplete
proof. See [evidence](../../../docs/case-studies/issue-3785/evidence/native-gemini-atomic-publication.txt).
