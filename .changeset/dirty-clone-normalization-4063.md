---
'@link-assistant/hive-mind': patch
---

Fix `Repository has uncommitted changes after clone` for repositories whose committed bytes do not match their own `.gitattributes`, such as a CRLF `mvnw.cmd` committed under `text eol=crlf` (issue #4063). When every path reported after the clone holds exactly the committed bytes, solve now turns off conversion for those paths in the clone-local `.git/info/attributes` and continues, and it logs the `git add --renormalize` fix for the repository owner (with `--verbose` attribute and eol diagnostics). Real changes still stop the run, and the error now names the first changed path.

Also update links-notation to 0.31.5 and rc-config-loader to 4.1.5 for the dependency freshness gate.
