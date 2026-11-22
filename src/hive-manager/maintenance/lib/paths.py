"""Descriptor-relative access to the fixed paths used by global quarantine."""

from contextlib import contextmanager
import os
from pathlib import Path
import shutil
import stat


DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
READ_FILE = os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW
MAX_CONFIG = 1024 * 1024


def identity(info):
    return info.st_dev, info.st_ino


def revision(info):
    return (*identity(info), info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)


def info_at(parent, name):
    try:
        return os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        return None


def make_directory(parent, name):
    os.mkdir(name, mode=0o700, dir_fd=parent)
    fd = os.open(name, DIRECTORY, dir_fd=parent)
    try:
        info = os.fstat(parent)
        os.fchown(fd, info.st_uid, info.st_gid)
    finally:
        os.close(fd)


@contextmanager
def at_path(root, relative, create=False):
    parts = Path(relative).parts
    fd = os.dup(root)
    try:
        for component in parts[:-1]:
            try:
                next_fd = os.open(component, DIRECTORY, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    yield None, parts[-1]
                    return
                make_directory(fd, component)
                next_fd = os.open(component, DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        yield fd, parts[-1]
    finally:
        os.close(fd)


def children(root, relative):
    with at_path(root, relative) as (parent, name):
        if parent is None or info_at(parent, name) is None:
            return []
        fd = os.open(name, DIRECTORY, dir_fd=parent)
        try:
            with os.scandir(fd) as entries:
                names = []
                for entry in entries:
                    if len(names) >= 10_000:
                        raise ValueError('Too many global extension entries.')
                    names.append(entry.name)
                return sorted(names)
        finally:
            os.close(fd)


def read_config(parent, name, info, protected, limit=MAX_CONFIG):
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or identity(info) in protected or info.st_size > limit:
        raise ValueError('Unsafe global config or alias to protected state.')
    with os.fdopen(os.open(name, READ_FILE, dir_fd=parent), 'rb') as source:
        if revision(os.fstat(source.fileno())) != revision(info):
            raise ValueError('Global config changed during inspection.')
        data = source.read(limit + 1)
        if len(data) > limit or revision(os.fstat(source.fileno())) != revision(info):
            raise ValueError('Global config changed during inspection.')
        return data


def mount_id(fd):
    data = Path(f'/proc/self/fdinfo/{fd}').read_text().splitlines()
    return next(line.split()[1] for line in data if line.startswith('mnt_id:'))


def check_extension(fd, root_mount, protected):
    info = os.fstat(fd)
    if identity(info) in protected or mount_id(fd) != root_mount:
        raise ValueError('Global extension aliases protected or mounted state.')
    if stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        return info
    raise ValueError('Unexpected file type in global extension state.')


def visit_extension(parent, name, root_mount, protected, target=None):
    # O_PATH lets us check inode and mount identity even for a symlink. Recursing
    # through held directory descriptors keeps links out of the traversal.
    fd = os.open(name, os.O_PATH | os.O_NOFOLLOW, dir_fd=parent)
    try:
        info = check_extension(fd, root_mount, protected)
        if stat.S_ISLNK(info.st_mode):
            if target:
                target.symlink_to(os.readlink('', dir_fd=fd))
            return True
        if stat.S_ISREG(info.st_mode):
            if target:
                with open(f'/proc/self/fd/{fd}', 'rb') as source, target.open('xb') as copy:
                    shutil.copyfileobj(source, copy)
                    os.fchmod(copy.fileno(), stat.S_IMODE(info.st_mode) & 0o700)
            return True
        if target:
            target.mkdir(mode=0o700)
        found = False
        with os.scandir(f'/proc/self/fd/{fd}') as entries:
            for entry in entries:
                found |= visit_extension(fd, entry.name, root_mount, protected, target / entry.name if target else None)
        return found
    finally:
        os.close(fd)
