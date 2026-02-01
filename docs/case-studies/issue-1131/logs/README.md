# Logs Archive

This directory contains analysis logs for the git identity corruption case study.

The actual log files are not tracked in git due to their size (~3.3MB total).

## How to Obtain Logs

The logs can be downloaded from the original gists:

| File | Source |
|------|--------|
| `pr-1117-session-2026-01-14T17-09.txt` | [Gist](https://gist.github.com/konard/ad0942eb6b30f7dfa19f1cd386e6d9e9) |
| `pr-1117-session-2026-01-15T07-50.txt` | [Gist](https://gist.github.com/konard/678e26465fe2d7b6cbfbaf4d8a562b7b) |
| `pr-207-session-2026-01-14T17-14.txt` | [Gist](https://gist.github.com/konard/f9c81e25f09915f4c5b44dc575b37488) |
| `pr-207-session-2026-01-15T02-53.txt` | [Gist](https://gist.github.com/konard/ba7660a48126e79817a0ee764043ee92) |
| `pr-207-session-2026-01-15T08-02.txt` | [Gist](https://gist.github.com/konard/9909322d03252ea2079ab3a643eddcc4) |

## Key Evidence

The critical evidence is in `pr-207-session-2026-01-15T02-53.txt` at line 4435, showing:
```
lrwxrwxrwx  1 hive hive  49 Jan 15 00:11 .gitconfig -> /tmp/gh-issue-solver-1768432183293/git/.gitconfig
```

This reveals that `.gitconfig` was a broken symlink pointing to a deleted temp directory.
