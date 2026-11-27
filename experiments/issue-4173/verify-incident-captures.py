"""Verify the archived logs and compare the two captures of the GitHub API output."""

import argparse
import hashlib
import json
from itertools import islice
from pathlib import Path


CASE_STUDY = Path(__file__).resolve().parents[2] / "docs/case-studies/issue-4173"


def capture(path, number):
    with path.open("rb") as stream:
        row = next(islice(stream, number - 1, None)).removesuffix(b"\n")
    text = row[row.index(b"{") :].decode()
    decode = json.JSONDecoder().raw_decode
    issue, end = decode(text)
    text = text[end:].lstrip()
    comments, end = decode(text)
    text = text[end:].lstrip()
    pull_request, end = decode(text)
    assert not text[end:].strip(), "Unexpected content after the GitHub API response"
    return (row, issue, comments, pull_request)


def compare(directory):
    wrapper, wrapper_issue, wrapper_comments, wrapper_pr = capture(
        directory / "wrapper.log", 1440
    )
    docker, docker_issue, docker_comments, docker_pr = capture(
        directory / "docker.log", 1416
    )
    return {
        "wrapperBytes": len(wrapper),
        "dockerBytes": len(docker),
        "dockerSha256": hashlib.sha256(docker).hexdigest(),
        "issueMatches": wrapper_issue == docker_issue,
        "commentsMatch": wrapper_comments == docker_comments,
        "pullRequestMatches": wrapper_pr["html_url"] == docker_pr["html_url"],
        "headMatches": wrapper_pr["head"]["sha"] == docker_pr["head"]["sha"],
        "baseMatches": wrapper_pr["base"]["sha"] == docker_pr["base"]["sha"],
        "titleMatches": wrapper_pr["title"] == docker_pr["title"],
        "baseRepoMatches": wrapper_pr["base"]["repo"] == docker_pr["base"]["repo"],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_directory", type=Path)
    directory = parser.parse_args().capture_directory
    inventory = json.loads((CASE_STUDY / "artifacts.json").read_text())
    for artifact in inventory["downloads"]:
        name = artifact["file"]
        if not name.endswith(".log"):
            continue
        with (directory / name).open("rb") as stream:
            assert stream.seek(0, 2) == artifact["bytes"], f"Size differs for {name}"
            stream.seek(0)
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        assert digest == artifact["sha256"], f"Digest differs for {name}"
    comparison = compare(directory)
    expected = json.loads((CASE_STUDY / "capture-comparison.json").read_text())
    assert comparison == expected, "The comparison differs from the archived result"
    print(json.dumps(comparison, indent=2))


if __name__ == "__main__":
    main()
