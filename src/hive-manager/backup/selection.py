"""Resolve and recheck the sources of a reviewed deployment backup."""

import contextlib
import json
import os
import posixpath
import re
import stat
import subprocess
import tarfile


PROVIDERS = {"claude": ("claude", "claude.json"), "codex": ("codex",)}
COMMON_STATE = ("agents", "gh", "git", "hive", "start-command", "start-logs")
VERSION = 1
STOPPED = {"created", "exited"}
NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*")
CONTAINER_ID = re.compile(r"[a-f0-9]{64}")
INSPECT = ('{"id":{{json .Id}},"name":{{json .Name}},'
           '"state":{{json .State}},"mounts":{{json .Mounts}}}')
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
READ_FLAGS = os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW


def canonical_path(path):
    if (not path.startswith("/") or path.startswith("//") or path == "/"
            or posixpath.normpath(path) != path or any(ord(c) < 32 for c in path)):
        raise ValueError(f"Expected a normalized absolute path below /: {path!r}")
    return path


def within(path, root):
    return path == root or path.startswith(root + "/")


def overlaps(left, right):
    return within(left, right) or within(right, left)


def ownership(mode, uid, gid):
    return {"mode": stat.S_IMODE(mode), "uid": uid, "gid": gid}


def host_identity(info):
    if stat.S_ISDIR(info.st_mode):
        kind = "directory"
    elif stat.S_ISREG(info.st_mode):
        kind = "file"
    else:
        raise ValueError("A selected source root must be a regular file or directory")
    return {"device": info.st_dev, "inode": info.st_ino, "type": kind,
            "ownership": ownership(info.st_mode, info.st_uid, info.st_gid)}


def archive_identity(member):
    if not (member.isdir() or member.isfile()):
        raise ValueError("A selected container path must be a regular file or directory")
    return {"type": "directory" if member.isdir() else "file",
            "ownership": ownership(member.mode, member.uid, member.gid)}


def docker(*args):
    return subprocess.check_output(["docker", *args], encoding="utf-8", errors="surrogateescape").strip()


def inspect_container(reference):
    if not NAME.fullmatch(reference):
        raise ValueError(f"Invalid container reference: {reference!r}")
    data = json.loads(docker("container", "inspect", "--format", INSPECT, "--", reference))
    if not CONTAINER_ID.fullmatch(data["id"]):
        raise ValueError("Docker did not return a full container ID")
    state = data["state"]
    mounts = data["mounts"] or []
    data["mounts"] = sorted(mounts, key=lambda mount: mount["Destination"])
    data["state"] = {key: state[key] for key in ("Status", "StartedAt", "FinishedAt")}
    if state["Status"] not in STOPPED:
        raise ValueError(f"Stop container {data['name']} before planning or taking a backup")
    return data


def deployment_container(name):
    ids = docker("container", "ls", "--all", "--no-trunc", "--filter",
                 rf"name=^/{re.escape(name)}$", "--format", "{{.ID}}").splitlines()
    if not ids:
        return None
    if len(ids) != 1:
        raise ValueError(f"Ambiguous deployment container: {name}")
    container = inspect_container(ids[0])
    if container["name"] != "/" + name:
        raise ValueError(f"Deployment container changed: {name}")
    return container


def present_mounts():
    with open("/proc/self/mountinfo", encoding="utf-8", errors="surrogateescape") as mounts:
        return sorted({re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), line.split()[4])
                       for line in mounts})


def nested_mounts(root, mounts):
    return sorted(path for path in mounts if path != root and within(path, root))


def host_source(kind, path, destination, mounts):
    path = canonical_path(path)
    info = os.lstat(path)
    resolved = os.path.realpath(path, strict=True)
    return {"kind": kind, "path": resolved, "destination": destination,
            "root": host_identity(info), "excluded_mounts": nested_mounts(resolved, mounts)}


@contextlib.contextmanager
def docker_tar(container, path, *, preview=False):
    with subprocess.Popen(["docker", "container", "cp", f"{container}:{path}", "-"],
                          stdin=subprocess.DEVNULL, stdout=subprocess.PIPE) as child:
        try:
            with tarfile.open(fileobj=child.stdout, mode="r|") as archive:
                yield archive
            if not preview:
                while child.stdout.read(64 * 1024):
                    pass
                if child.wait():
                    raise ValueError(f"Docker could not read selected path {path!r}")
        finally:
            if child.poll() is None:
                child.kill()


def container_root(archive, path):
    member = archive.next()
    if member is None or member.name != posixpath.basename(path):
        raise ValueError(f"Docker did not return the selected path {path!r}")
    return member


def container_source(kind, container, path, destination, state_dir, mount=None):
    path = canonical_path(path)
    mounts = container["mounts"]
    if mount:
        if any(candidate != mount and within(candidate["Destination"], path) for candidate in mounts):
            raise ValueError(f"Select nested mounts separately: {path!r}")
        if mount["Type"] not in {"bind", "volume"}:
            raise ValueError(f"Only Docker bind and volume mounts can be selected: {path!r}")
        if mount["Type"] == "bind" and overlaps(os.path.realpath(mount["Source"]), state_dir):
            raise ValueError(f"Use the state or provider scope for a bind inside deployment state: {path!r}")
    else:
        if any(overlaps(path, candidate["Destination"]) for candidate in mounts):
            raise ValueError(f"Legacy path overlaps a Docker mount: {path!r}")
        changes = docker("container", "diff", "--", container["id"]).split("\n")
        if f"A {path}" not in changes and f"C {path}" not in changes:
            raise ValueError(f"Legacy path is absent from the container's writable-layer changes: {path!r}")
    with docker_tar(container["id"], path, preview=True) as archive:
        root = archive_identity(container_root(archive, path))
    source = {"kind": kind, "path": path, "destination": destination,
              "container": container["id"], "root": root}
    if mount:
        source["mount"] = mount
    return source


def source_spec(spec):
    label, separator, path = spec.partition("=")
    if not separator or not NAME.fullmatch(label) or not path:
        raise ValueError(f"Expected NAME=PATH for an additional source: {spec!r}")
    return f"additional/{label}", path


def state_sources(state_dir, selection, mounts):
    sources, excluded = [], {}
    state_exists = os.path.isdir(state_dir)
    selected = set(COMMON_STATE if selection["state"] else ())
    for provider in selection["providers"]:
        selected.update(PROVIDERS[provider])
        if not any(os.path.lexists(os.path.join(state_dir, path)) for path in PROVIDERS[provider]):
            raise ValueError(f"No state found for selected provider: {provider}")
    for path in sorted(set(os.listdir(state_dir) if state_exists else ()) | selected):
        destination = f"state/{path}"
        source = os.path.join(state_dir, path)
        if path not in selected:
            excluded[destination] = "state entry outside selected scope"
        elif not os.path.lexists(source):
            excluded[destination] = "selected state entry absent"
        else:
            sources.append(host_source("state", source, destination, mounts))
    return sources, excluded


def build_plan(name, state_dir, selection):
    if (not isinstance(selection, dict) or set(selection) != {"state", "providers", "paths", "mounts", "legacy"}
            or not isinstance(selection["state"], bool)
            or any(not isinstance(values, list) or any(not isinstance(value, str) for value in values)
                   for key, values in selection.items() if key != "state")
            or not set(selection["providers"]) <= PROVIDERS.keys()):
        raise ValueError("Invalid backup source selection")
    state_dir = canonical_path(os.path.realpath(state_dir))
    mounts = present_mounts()
    deployment = deployment_container(name)
    containers = {deployment["id"]: deployment} if deployment else {}
    sources, excluded = state_sources(state_dir, selection, mounts)

    for spec in selection["paths"]:
        destination, path = source_spec(spec)
        source = host_source("path", path, destination, mounts)
        if overlaps(source["path"], state_dir):
            raise ValueError(f"Use the state or provider scope for a path overlapping deployment state: {path!r}")
        sources.append(source)
    for spec in selection["mounts"]:
        destination, path = source_spec(spec)
        container = deployment
        if not path.startswith("/"):
            reference, separator, path = path.partition(":")
            if not separator:
                raise ValueError("Use NAME=/TARGET or NAME=CONTAINER:/TARGET for a mount")
            container = inspect_container(reference)
            containers[container["id"]] = container
        mount = next((entry for entry in container["mounts"] if entry["Destination"] == path), None) if container else None
        if mount is None:
            raise ValueError(f"No Docker mount at {path!r}")
        sources.append(container_source("mount", container, path, destination, state_dir, mount))
    for spec in selection["legacy"]:
        destination, reference = source_spec(spec)
        container_name, separator, path = reference.partition(":")
        if not separator:
            raise ValueError("Use NAME=CONTAINER:/path for a legacy source")
        container = inspect_container(container_name)
        containers[container["id"]] = container
        sources.append(container_source("legacy", container, path, destination, state_dir))

    if not sources:
        raise ValueError("No backup sources selected. Use --state, --provider, --path, --mount or --legacy.")
    destinations = [source["destination"] for source in sources]
    if len(set(destinations)) != len(destinations):
        raise ValueError("Additional source names must be unique")
    selected_binds = {source["path"] for source in sources if source["kind"] == "state"}
    selected_mounts = {(source["container"], source["path"]) for source in sources if source["kind"] == "mount"}
    for container_id, container in containers.items():
        for mount in container["mounts"]:
            target = mount["Destination"]
            if (container_id, target) not in selected_mounts and not (
                    mount["Type"] == "bind" and os.path.realpath(mount["Source"]) in selected_binds):
                excluded[f"mount:{container['name'][1:]}:{target}"] = "Docker mount outside selected scope"
    return {"version": VERSION, "private": True, "deployment": name, "state_dir": state_dir,
            "selection": selection, "containers": containers, "sources": sources, "excluded": excluded}


def recheck_plan(plan):
    current = deployment_container(plan["deployment"])
    if current and current["id"] not in plan["containers"]:
        raise ValueError("The deployment container changed while taking the backup")
    for container_id, reviewed in plan["containers"].items():
        if inspect_container(container_id) != reviewed:
            raise ValueError(f"Container changed while taking the backup: {container_id}")
    mounts = present_mounts()
    for source in plan["sources"]:
        if source["kind"] in {"state", "path"}:
            path = source["path"]
            if (host_identity(os.lstat(path)) != source["root"]
                    or nested_mounts(path, mounts) != source["excluded_mounts"]):
                raise ValueError(f"Source changed while taking the backup: {path!r}")


@contextlib.contextmanager
def open_source(path):
    # Walk the reviewed canonical host path without following swapped symlinks.
    parts = path[1:].split("/")
    descriptor = os.open("/", DIR_FLAGS)
    try:
        for part in parts[:-1]:
            child = os.open(part, DIR_FLAGS, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        source = os.open(parts[-1], READ_FLAGS, dir_fd=descriptor)
        try:
            yield source
        finally:
            os.close(source)
    finally:
        os.close(descriptor)
