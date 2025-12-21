---
'@link-assistant/hive-mind': patch
---

Fix Rocq installation verification by sourcing opam environment

- Source opam environment before verifying Rocq in installation summary
- Use `rocq -v` for verification as recommended by official documentation
- Update CI workflow to require Rocq to be accessible (not optional)
- Add case study documenting the issue and solution
