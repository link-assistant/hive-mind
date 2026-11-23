"""Write and verify private, streaming deployment backup bundles."""

import contextlib
import gzip
import hashlib
import io
import json
import os
import stat
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from selection import (
    READ_FLAGS, VERSION, archive_identity, container_root, docker_tar,
    host_identity, open_source, ownership, recheck_plan, within,
)


MAGIC = b"HIVE-MIND-PRIVATE-BACKUP 1\n"
RECEIPT = "MANIFEST.json"
JSON_LIMIT = 64 * 1024 * 1024
BLOCK = 128 * 1024


def json_bytes(document):
    return (json.dumps(document, sort_keys=True, ensure_ascii=True, indent=2) + "\n").encode("ascii")


def read_json(stream):
    data = stream.read(JSON_LIMIT + 1)
    if len(data) > JSON_LIMIT:
        raise ValueError("Backup plan or manifest exceeds the format size limit")
    return json.loads(data)


def file_details(member):
    return {"path": member.name, "type": "directory" if member.isdir() else "file",
            "size": member.size, "mtime": member.mtime,
            **ownership(member.mode, member.uid, member.gid)}


def safe_parts(path):
    parts = path.split("/")
    if any(part in ("", ".", "..") or "\0" in part for part in parts):
        raise ValueError(f"Unsafe bundle path: {path!r}")
    return parts


class HashedInput:
    def __init__(self, source):
        self.source = source
        self.digest = hashlib.sha256()

    def read(self, size):
        data = self.source.read(size)
        self.digest.update(data)
        return data


class BundleWriter:
    def __init__(self, archive):
        self.archive = archive
        self.entries = {}
        self.skipped = []

    def skip(self, path, reason):
        self.skipped.append({"path": path, "reason": reason})

    def add(self, path, info, stream=None):
        safe_parts(path)
        if path in self.entries:
            raise ValueError(f"Duplicate bundle path: {path!r}")
        entry = tarfile.TarInfo(path)
        entry.uid, entry.gid, entry.mode = info.uid, info.gid, info.mode
        entry.mtime = int(info.mtime)
        if info.isdir():
            entry.type = tarfile.DIRTYPE
        else:
            entry.size = info.size
        hashed = HashedInput(stream) if stream is not None else None
        self.archive.addfile(entry, hashed)
        details = file_details(entry)
        if hashed is not None:
            details["sha256"] = hashed.digest.hexdigest()
        self.entries[path] = details

    def manifest(self, plan):
        document = {"version": VERSION, "private": True, "plan": plan,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "entries": self.entries, "skipped": self.skipped}
        encoded = json_bytes(document)
        if len(encoded) > JSON_LIMIT:
            raise ValueError("Backup manifest exceeds the format size limit")
        entry = tarfile.TarInfo(RECEIPT)
        entry.mode = 0o600
        entry.size = len(encoded)
        self.archive.addfile(entry, io.BytesIO(encoded))


def host_tar_info(info):
    member = tarfile.TarInfo()
    member.uid, member.gid, member.mode = info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)
    member.mtime = int(info.st_mtime)
    if stat.S_ISDIR(info.st_mode):
        member.type = tarfile.DIRTYPE
    else:
        member.size = info.st_size
    return member


def file_signature(info):
    return info.st_dev, info.st_ino, info.st_ctime_ns, info.st_mtime_ns, info.st_size


def copy_host_entry(writer, descriptor, path, destination, excluded_mounts):
    initial = os.fstat(descriptor)
    host_identity(initial)
    info = host_tar_info(initial)
    if info.isdir():
        writer.add(destination, info)
        for name in sorted(os.listdir(descriptor)):
            child, target = f"{path}/{name}", f"{destination}/{name}"
            if child in excluded_mounts:
                writer.skip(target, "nested filesystem mount")
                continue
            before = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            if not (stat.S_ISDIR(before.st_mode) or stat.S_ISREG(before.st_mode)):
                writer.skip(target, "symbolic link or special file")
                continue
            child_fd = os.open(name, READ_FLAGS, dir_fd=descriptor)
            try:
                if file_signature(os.fstat(child_fd)) != file_signature(before):
                    raise ValueError(f"Source changed while opening {child!r}")
                copy_host_entry(writer, child_fd, child, target, excluded_mounts)
            finally:
                os.close(child_fd)
    else:
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            writer.add(destination, info, stream)
    if file_signature(os.fstat(descriptor)) != file_signature(initial):
        raise ValueError(f"Source changed while reading {path!r}")


def copy_host(writer, source):
    path = source["path"]
    with open_source(path) as descriptor:
        if host_identity(os.fstat(descriptor)) != source["root"]:
            raise ValueError(f"Source changed since review: {path!r}")
        copy_host_entry(writer, descriptor, path, source["destination"], set(source["excluded_mounts"]))


def copy_container(writer, source):
    path = source["path"]
    destination = source["destination"]
    with docker_tar(source["container"], path) as archive:
        root = container_root(archive, path)
        if archive_identity(root) != source["root"]:
            raise ValueError(f"Container source changed since review: {path!r}")
        member = root
        while member is not None:
            safe_parts(member.name)
            if not within(member.name, root.name):
                raise ValueError(f"Docker archive entry is outside selected path: {member.name!r}")
            target = destination + member.name[len(root.name):]
            if member.isdir():
                writer.add(target, member)
            elif member.isfile():
                with archive.extractfile(member) as stream:
                    writer.add(target, member, stream)
            else:
                writer.skip(target, "Docker archive link or special file")
            archive.members.clear()
            member = archive.next()


def write_bundle(output, plan):
    output.write(MAGIC)
    with gzip.GzipFile(fileobj=output, mode="wb", compresslevel=3, mtime=0) as compressed:
        with tarfile.open(mode="w|", fileobj=compressed, format=tarfile.PAX_FORMAT) as archive:
            writer = BundleWriter(archive)
            for source in plan["sources"]:
                if source["kind"] in {"state", "path"}:
                    copy_host(writer, source)
                else:
                    copy_container(writer, source)
            recheck_plan(plan)
            writer.manifest(plan)


def check_output_path(path, plan):
    roots = [plan["state_dir"], *(source["path"] for source in plan["sources"] if source["kind"] == "path")]
    roots.extend(os.path.realpath(mount["Source"])
                 for container in plan["containers"].values() for mount in container["mounts"]
                 if mount["Type"] in {"bind", "volume"} and mount.get("Source"))
    if any(within(str(path), root) for root in roots):
        raise ValueError("Choose an output outside deployment state and Docker mounts or additional paths")


@contextlib.contextmanager
def private_output(path, plan):
    dest = Path(path).absolute()
    parent = dest.parent.resolve(strict=True)
    dest = parent / dest.name
    check_output_path(dest, plan)
    if os.path.lexists(dest):
        raise FileExistsError(f"Backup output already exists: {dest}")
    with tempfile.NamedTemporaryFile(dir=parent, prefix=".hive-backup-") as output:
        yield output
        output.flush()
        os.fsync(output.fileno())
        os.link(output.name, dest, follow_symlinks=False)


def verify_manifest(document, entries):
    if (not isinstance(document, dict) or document.get("version") != VERSION or document.get("private") is not True
            or document.get("entries") != entries):
        raise ValueError("Manifest does not match bundle contents, checksums or source permissions")
    plan = document.get("plan")
    if not isinstance(plan, dict) or plan.get("version") != VERSION or plan.get("private") is not True:
        raise ValueError("Bundle has no private backup plan")
    sources = plan.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("Bundle has no reviewed sources")
    roots = {path for path in entries if path.count("/") == 1}
    for source in sources:
        path = source.get("destination") if isinstance(source, dict) else None
        if not isinstance(path, str) or path not in roots:
            raise ValueError("Bundle source roots do not match the reviewed plan")
        roots.remove(path)
        root = source.get("root")
        entry = entries[path]
        if (not isinstance(root, dict) or root.get("type") != entry["type"]
                or root.get("ownership") != ownership(entry["mode"], entry["uid"], entry["gid"])):
            raise ValueError(f"Bundle source does not match reviewed ownership: {path!r}")
    if roots:
        raise ValueError("Bundle has a source root outside the reviewed plan")


def verify_permissions(path, mode, owner):
    expected_owner = owner or (os.geteuid(), os.getegid())
    current = path.stat()
    if (current.st_uid, current.st_gid) != expected_owner:
        os.chown(path, *expected_owner)
    os.chmod(path, mode)
    info = path.stat()
    if (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid) != (mode, *expected_owner):
        raise ValueError(f"Could not verify private permissions: {str(path)!r}")


def restore_entry(archive, member, target, owner, entries):
    if member.type not in (tarfile.REGTYPE, tarfile.DIRTYPE) or member.mode & ~0o7777 or member.size < 0:
        raise ValueError(f"Invalid bundle entry metadata: {member.name!r}")
    parts = safe_parts(member.name)
    if len(parts) < 2 or parts[0] not in {"state", "additional"} or member.name in entries:
        raise ValueError(f"Unexpected or duplicate bundle entry: {member.name!r}")
    output = target.joinpath(*parts)
    entry = file_details(member)
    if member.isdir():
        if member.size != 0:
            raise ValueError(f"Invalid bundle directory size: {member.name!r}")
        output.mkdir(mode=0o700)
    else:
        with archive.extractfile(member) as source, output.open("xb") as stream:
            hashed = HashedInput(source)
            while data := hashed.read(BLOCK):
                stream.write(data)
            entry["sha256"] = hashed.digest.hexdigest()
        if output.stat().st_size != member.size:
            raise ValueError(f"Restored file has the wrong size: {member.name!r}")
        verify_permissions(output, 0o600 | (member.mode & 0o100), owner)
        os.utime(output, (member.mtime, member.mtime))
    entries[member.name] = entry


def extract_bundle(stream, target, owner):
    if stream.read(len(MAGIC)) != MAGIC:
        raise ValueError("Input is not a Hive Mind private backup bundle")
    entries = {}
    manifest = None
    for namespace in ("state", "additional"):
        (target / namespace).mkdir(mode=0o700)
    with gzip.GzipFile(fileobj=stream, mode="rb") as compressed:
        with tarfile.open(mode="r|", fileobj=compressed) as archive:
            for member in archive:
                if manifest is not None:
                    raise ValueError("Bundle manifest must be the last archive entry")
                if member.name == RECEIPT:
                    if member.type != tarfile.REGTYPE or member.mode != 0o600:
                        raise ValueError("Invalid private bundle manifest metadata")
                    with archive.extractfile(member) as source:
                        manifest = read_json(source)
                    verify_manifest(manifest, entries)
                else:
                    restore_entry(archive, member, target, owner, entries)
                archive.members.clear()
            if archive.fileobj.read(tarfile.BLOCKSIZE) != b"\0" * tarfile.BLOCKSIZE:
                raise ValueError("Missing bundle archive end marker")
            # Drain tar's buffered bytes and check the gzip trailer before publication.
            while block := archive.fileobj.read(BLOCK):
                if block.strip(b"\0"):
                    raise ValueError("Unexpected data after the bundle archive")
    if manifest is None:
        raise ValueError("Private bundle has no manifest")
    for path, entry in reversed(entries.items()):
        if entry["type"] == "directory":
            directory = target / path
            verify_permissions(directory, 0o700, owner)
            os.utime(directory, (entry["mtime"], entry["mtime"]))
    for namespace in ("state", "additional"):
        verify_permissions(target / namespace, 0o700, owner)
    receipt = target / RECEIPT
    receipt.write_bytes(json_bytes(manifest))
    verify_permissions(receipt, 0o600, None)


def restore_bundle(stream, destination, owner):
    dest = Path(destination).absolute()
    if os.path.lexists(dest):
        raise FileExistsError(f"Restore requires a new directory: {dest}")
    with tempfile.TemporaryDirectory(dir=dest.parent, prefix=".hive-restore-") as directory:
        stage = Path(directory) / "restore"
        stage.mkdir(mode=0o700)
        extract_bundle(stream, stage, owner)
        verify_permissions(stage, 0o700, None)
        subprocess.run(["mv", "-nT", "--", stage, dest], check=True)
        if stage.exists():
            raise FileExistsError(f"Restore requires a new directory: {dest}")
