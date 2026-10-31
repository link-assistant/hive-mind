/* A bounded system-SQLite design control, not the production Codex adapter.
 * Compile: cc -std=c11 -Wall -Wextra -Werror probe-sqlite-vfs-close.c -lsqlite3
 * The Python driver owns temporary directories, hashes and process limits.
 */
#define _GNU_SOURCE
#include <assert.h>
#include <fcntl.h>
#include <sqlite3.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

typedef struct {
  sqlite3_file base;
  sqlite3_file *real;
} GuardedFile;

static sqlite3_vfs *parent;
static sqlite3_vfs guarded;
static const char *root_path;
static char database_path[4096];
static int root_fd = -1, database_fd = -1;
static atomic_int rejected;
static unsigned int blocked_io, progress_calls;

static int same(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino;
}

static int safe(void) {
  struct stat held, named;
  if (atomic_load(&rejected)) return 0;
  if (fstat(root_fd, &held) || lstat(root_path, &named) ||
      !S_ISDIR(named.st_mode) || named.st_uid != geteuid() ||
      (named.st_mode & 077) || !same(&held, &named)) goto refuse;
  if (database_fd >= 0 &&
      (fstat(database_fd, &held) || lstat(database_path, &named) ||
       !S_ISREG(named.st_mode) || named.st_uid != geteuid() ||
       named.st_nlink != 1 || (named.st_mode & 022) ||
       !same(&held, &named))) goto refuse;
  return 1;
refuse:
  atomic_store(&rejected, 1);
  return 0;
}

static int admission(void) {
  if (safe()) return SQLITE_OK;
  blocked_io++;
  return SQLITE_IOERR;
}

static int progress(void *unused) {
  (void)unused;
  assert(++progress_calls < 10000);
  return !safe();
}

#define FILE_PAIR(file) \
  GuardedFile *wrapper = (GuardedFile *)(file); \
  sqlite3_file *real = wrapper->real
#define REQUIRE_SAFE() do { int result = admission(); if (result) return result; } while (0)

static int guarded_close(sqlite3_file *file) {
  FILE_PAIR(file);
  /* SQLite checkpoint writes have already passed through xWrite. Never let
   * unsafe shared-memory cleanup delete the replacement's named SHM file. */
  if (!safe() && real->pMethods->iVersion >= 2 && real->pMethods->xShmUnmap)
    real->pMethods->xShmUnmap(real, 0);
  int result = real->pMethods->xClose(real);
  free(real);
  wrapper->real = NULL;
  wrapper->base.pMethods = NULL;
  return result;
}

static int guarded_read(sqlite3_file *file, void *buffer, int size, sqlite3_int64 offset) {
  FILE_PAIR(file); REQUIRE_SAFE();
  return real->pMethods->xRead(real, buffer, size, offset);
}

static int guarded_write(sqlite3_file *file, const void *buffer, int size, sqlite3_int64 offset) {
  FILE_PAIR(file); REQUIRE_SAFE();
  return real->pMethods->xWrite(real, buffer, size, offset);
}

static int guarded_truncate(sqlite3_file *file, sqlite3_int64 size) {
  FILE_PAIR(file); REQUIRE_SAFE();
  return real->pMethods->xTruncate(real, size);
}

static int guarded_sync(sqlite3_file *file, int flags) {
  FILE_PAIR(file); REQUIRE_SAFE();
  return real->pMethods->xSync(real, flags);
}

static int guarded_size(sqlite3_file *file, sqlite3_int64 *size) {
  FILE_PAIR(file); REQUIRE_SAFE();
  return real->pMethods->xFileSize(real, size);
}

static int guarded_lock(sqlite3_file *file, int lock) {
  FILE_PAIR(file); REQUIRE_SAFE();
  return real->pMethods->xLock(real, lock);
}

static int guarded_unlock(sqlite3_file *file, int lock) {
  FILE_PAIR(file);
  /* Releasing an existing lock must remain possible after refusal. */
  return real->pMethods->xUnlock(real, lock);
}

static int guarded_reserved(sqlite3_file *file, int *locked) {
  FILE_PAIR(file); REQUIRE_SAFE();
  return real->pMethods->xCheckReservedLock(real, locked);
}

static int guarded_control(sqlite3_file *file, int operation, void *argument) {
  FILE_PAIR(file); REQUIRE_SAFE();
  if (operation == SQLITE_FCNTL_MMAP_SIZE) *(sqlite3_int64 *)argument = 0;
  return real->pMethods->xFileControl(real, operation, argument);
}

static int guarded_sector(sqlite3_file *file) {
  FILE_PAIR(file);
  return real->pMethods->xSectorSize(real);
}

static int guarded_characteristics(sqlite3_file *file) {
  FILE_PAIR(file);
  return real->pMethods->xDeviceCharacteristics(real);
}

static int guarded_shm_map(sqlite3_file *file, int page, int size, int extend, void volatile **mapping) {
  FILE_PAIR(file); REQUIRE_SAFE();
  return real->pMethods->xShmMap(real, page, size, extend, mapping);
}

static int guarded_shm_lock(sqlite3_file *file, int offset, int count, int flags) {
  FILE_PAIR(file);
  if (!(flags & SQLITE_SHM_UNLOCK)) REQUIRE_SAFE();
  return real->pMethods->xShmLock(real, offset, count, flags);
}

static void guarded_shm_barrier(sqlite3_file *file) {
  FILE_PAIR(file);
  real->pMethods->xShmBarrier(real);
}

static int guarded_shm_unmap(sqlite3_file *file, int remove_file) {
  FILE_PAIR(file);
  return real->pMethods->xShmUnmap(real, safe() ? remove_file : 0);
}

static int guarded_fetch(sqlite3_file *file, sqlite3_int64 offset, int size, void **mapping) {
  (void)file; (void)offset; (void)size; REQUIRE_SAFE();
  /* Ordinary reads must retain the checked xRead boundary. */
  *mapping = NULL;
  return SQLITE_OK;
}

static int guarded_unfetch(sqlite3_file *file, sqlite3_int64 offset, void *mapping) {
  (void)file; (void)offset; (void)mapping;
  return SQLITE_OK;
}

static const sqlite3_io_methods methods = {
  3, guarded_close, guarded_read, guarded_write, guarded_truncate, guarded_sync,
  guarded_size, guarded_lock, guarded_unlock, guarded_reserved, guarded_control,
  guarded_sector, guarded_characteristics, guarded_shm_map, guarded_shm_lock,
  guarded_shm_barrier, guarded_shm_unmap, guarded_fetch, guarded_unfetch
};

static int guarded_open(sqlite3_vfs *vfs, const char *name, sqlite3_file *file, int flags, int *out_flags) {
  (void)vfs; REQUIRE_SAFE();
  GuardedFile *wrapper = (GuardedFile *)file;
  wrapper->real = calloc(1, (size_t)parent->szOsFile);
  if (!wrapper->real) return SQLITE_NOMEM;
  int result = parent->xOpen(parent, name, wrapper->real, flags, out_flags);
  if (result == SQLITE_OK && (flags & SQLITE_OPEN_MAIN_DB)) {
    assert(name && strcmp(name, database_path) == 0);
    database_fd = open(name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    assert(database_fd >= 0);
    if (!safe()) result = SQLITE_CANTOPEN;
  }
  if (result != SQLITE_OK) {
    if (wrapper->real->pMethods) wrapper->real->pMethods->xClose(wrapper->real);
    free(wrapper->real);
    wrapper->real = NULL;
    return result;
  }
  wrapper->base.pMethods = &methods;
  return SQLITE_OK;
}

static int guarded_delete(sqlite3_vfs *vfs, const char *name, int sync_directory) {
  (void)vfs; REQUIRE_SAFE();
  return parent->xDelete(parent, name, sync_directory);
}

static int guarded_access(sqlite3_vfs *vfs, const char *name, int flags, int *result) {
  (void)vfs; REQUIRE_SAFE();
  return parent->xAccess(parent, name, flags, result);
}

static void checked_exec(sqlite3 *connection, const char *sql) {
  char *error = NULL;
  int result = sqlite3_exec(connection, sql, NULL, NULL, &error);
  if (result != SQLITE_OK) fprintf(stderr, "SQLite %d: %s\n", result, error ? error : "unavailable");
  sqlite3_free(error);
  assert(result == SQLITE_OK);
}

int main(int argc, char **argv) {
  assert(argc == 3);
  int query_after_mutation = strcmp(argv[2], "query") == 0;
  assert(query_after_mutation || strcmp(argv[2], "close-only") == 0);
  root_path = argv[1];
  assert(snprintf(database_path, sizeof(database_path), "%s/state.sqlite", root_path) < (int)sizeof(database_path));
  root_fd = open(root_path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  assert(root_fd >= 0 && safe());
  parent = sqlite3_vfs_find(NULL);
  assert(parent && parent->iVersion >= 2);
  guarded = *parent;
  guarded.zName = "issue-3785-design-control";
  guarded.szOsFile = (int)sizeof(GuardedFile);
  guarded.xOpen = guarded_open;
  guarded.xDelete = guarded_delete;
  guarded.xAccess = guarded_access;
  assert(sqlite3_vfs_register(&guarded, 0) == SQLITE_OK);
  sqlite3 *connection = NULL;
  assert(sqlite3_open_v2(database_path, &connection, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, guarded.zName) == SQLITE_OK);
  checked_exec(connection, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES ('bounded synthetic data');");
  sqlite3_progress_handler(connection, 1, progress, NULL);
  checked_exec(connection, "SELECT * FROM synthetic");
  printf("READY %s\n", sqlite3_libversion());
  fflush(stdout);
  assert(getchar() == '\n');
  int query = -1, write = -1;
  if (query_after_mutation) {
    query = sqlite3_exec(connection, "SELECT * FROM synthetic", NULL, NULL, NULL);
    write = sqlite3_exec(connection, "INSERT INTO synthetic VALUES ('after mutation')", NULL, NULL, NULL);
  }
  int close_result = sqlite3_close(connection);
  printf("RESULT query=%d write=%d close=%d refused=%d blocked=%u progress=%u\n", query, write, close_result, atomic_load(&rejected), blocked_io, progress_calls);
  close(database_fd);
  close(root_fd);
  assert(sqlite3_vfs_unregister(&guarded) == SQLITE_OK);
  return 0;
}
