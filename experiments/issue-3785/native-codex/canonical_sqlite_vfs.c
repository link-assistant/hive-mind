/* Linux selected-history SQLite authority. All state lives until process exit.
 * Ordinary SQLite connections retain their upstream VFS and callbacks.
 * Compile the pinned bundled SQLite with SQLITE_ENABLE_FILESTAT.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <pthread.h>
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define DATABASE_COUNT 7
#define ANCESTOR_COUNT 256
#define LIVE_FILE_LIMIT 1024
static const char *database_names[DATABASE_COUNT] = {
  "state_5.sqlite", "logs_2.sqlite", "goals_1.sqlite", "memories_1.sqlite",
  "memories_v2_1.sqlite", "queue_1.sqlite", "thread_history_1.sqlite"
};
static const char refusal[] = "Canonical SQLite configuration is unavailable or unsafe.\n";
static pthread_mutex_t gate = PTHREAD_MUTEX_INITIALIZER;
static sqlite3_vfs selected_vfs, *parent_vfs;
static char selected_root[PATH_MAX];
static int ancestors[ANCESTOR_COUNT], database_pins[DATABASE_COUNT], database_leases[DATABASE_COUNT];
static size_t ancestor_ends[ANCESTOR_COUNT], ancestor_count;
static uid_t selected_owner;
static int initialized;
static unsigned backup_sequence;
static _Thread_local const char *diagnostic_operation = "initialize";
#ifdef HIVE_CANONICAL_SQLITE_TEST
static unsigned anonymous_opens;
unsigned hive_canonical_sqlite_test_anonymous(void) { return anonymous_opens; }
#endif

typedef struct GuardedFile GuardedFile;
struct GuardedFile {
  sqlite3_file base;
  sqlite3_file *real;
  GuardedFile *next;
  char name[PATH_MAX];
  int descriptor, shared_descriptor;
};
static GuardedFile *live_files;

/* Never return an ordinary SQLx error that a native fallback could swallow.
 * _exit avoids SQLite checkpoints and other atexit writers after refusal.
 * A full stderr pipe cannot block refusal. No selected data is logged. */
static _Noreturn void refuse(void) {
  int saved_errno = errno;
  int flags = fcntl(STDERR_FILENO, F_GETFL);
  if (flags >= 0 && fcntl(STDERR_FILENO, F_SETFL, flags | O_NONBLOCK) == 0) {
    (void)write(STDERR_FILENO, refusal, sizeof(refusal) - 1);
    const char *diagnostics = getenv("HIVE_CODEX_SQLITE_TRACE");
    if (diagnostics && strcmp(diagnostics, "1") == 0) {
      char detail[192];
      int bytes = snprintf(detail, sizeof(detail), "Native SQLite refusal stage=%s errno=%d\n", diagnostic_operation, saved_errno);
      if (bytes > 0 && bytes < (int)sizeof(detail)) (void)write(STDERR_FILENO, detail, (size_t)bytes);
    }
  }
  _exit(78);
}

static void lock_gate(void) { if (pthread_mutex_lock(&gate)) refuse(); }
static void unlock_gate(void) { if (pthread_mutex_unlock(&gate)) refuse(); }

/* Managed direct children are inspected relative to the retained root. The
 * ancestor checks still validate its current name on both sides of each I/O;
 * avoid resolving that same absolute directory chain for every child. */
static int named_info(const char *name, struct stat *info) {
  size_t bytes = strlen(selected_root);
  if (ancestor_count && !strncmp(name, selected_root, bytes) && name[bytes] == '/' &&
      name[bytes + 1] && !strchr(name + bytes + 1, '/')) {
    return fstatat(ancestors[ancestor_count - 1], name + bytes + 1, info, AT_SYMLINK_NOFOLLOW);
  }
  return lstat(name, info);
}

static int same_file(const struct stat *held, const struct stat *named) {
  return held->st_dev == named->st_dev && held->st_ino == named->st_ino &&
      S_ISREG(held->st_mode) && S_ISREG(named->st_mode) &&
      held->st_uid == selected_owner && named->st_uid == selected_owner &&
      held->st_nlink == 1 && named->st_nlink == 1 &&
      !(held->st_mode & 022) && !(named->st_mode & 022);
}

static int matches(int descriptor, const char *name, int directory, int selected) {
  struct stat held, named;
  if (descriptor < 0 || fstat(descriptor, &held) || named_info(name, &named) ||
      held.st_dev != named.st_dev || held.st_ino != named.st_ino) return 0;
  if (directory) {
    if (!S_ISDIR(held.st_mode) || !S_ISDIR(named.st_mode)) return 0;
    return !selected || (held.st_uid == selected_owner && named.st_uid == selected_owner &&
                         !(held.st_mode & 077) && !(named.st_mode & 077));
  }
  return same_file(&held, &named);
}

static int filename(const char *name, int *database, const char **suffix) {
  if (!name) return 0;
  size_t root_bytes = strlen(selected_root);
  if (strncmp(name, selected_root, root_bytes) || name[root_bytes] != '/') return 0;
  const char *leaf = name + root_bytes + 1;
  for (int index = 0; index < DATABASE_COUNT; index++) {
    size_t bytes = strlen(database_names[index]);
    if (strncmp(leaf, database_names[index], bytes)) continue;
    const char *ending = leaf + bytes;
    if (*ending && strcmp(ending, "-wal") && strcmp(ending, "-shm") && strcmp(ending, "-journal"))
      continue;
    *database = index;
    *suffix = ending;
    return 1;
  }
  return 0;
}

static void check_named(const char *name, int missing_allowed) {
  int database;
  const char *suffix;
  struct stat info;
  if (!filename(name, &database, &suffix)) refuse();
  if (named_info(name, &info)) {
    if (missing_allowed && errno == ENOENT && (*suffix || database_pins[database] < 0)) return;
    refuse();
  }
  if (!S_ISREG(info.st_mode) || info.st_uid != selected_owner ||
      info.st_nlink != 1 || (info.st_mode & 022)) refuse();
  if (!*suffix && database_pins[database] >= 0) {
    struct stat held;
    if (fstat(database_pins[database], &held) || !same_file(&held, &info)) refuse();
  }
}

/* The gate covers borrowed descriptor use AND every selected xClose/unmap, so
 * another connection cannot close/reuse a descriptor while it is inspected. */
static void check_authority(void) {
  char prefix[PATH_MAX], path[PATH_MAX];
  const char *rollout = getenv("CODEX_ROLLOUT_HOME");
  const char *sqlite = getenv("CODEX_SQLITE_HOME");
  if (!rollout || !sqlite || strcmp(rollout, selected_root) || strcmp(sqlite, selected_root)) refuse();
  for (size_t index = 0; index < ancestor_count; index++) {
    memcpy(prefix, selected_root, ancestor_ends[index]);
    prefix[ancestor_ends[index]] = '\0';
    if (!matches(ancestors[index], prefix, 1, index + 1 == ancestor_count)) refuse();
  }
  for (int index = 0; index < DATABASE_COUNT; index++) {
    struct stat lease;
    struct stat named_lease;
    if (snprintf(path, sizeof(path), "%s/.%s.authority", selected_root, database_names[index]) >= (int)sizeof(path) ||
        fstat(database_leases[index], &lease) || named_info(path, &named_lease) ||
        !same_file(&lease, &named_lease) || (lease.st_mode & 077)) refuse();
    for (int suffix = 0; suffix < 4; suffix++) {
      const char *ending = (const char *[]) { "", "-wal", "-shm", "-journal" }[suffix];
      if (snprintf(path, sizeof(path), "%s/%s%s", selected_root, database_names[index], ending) >= (int)sizeof(path)) refuse();
      check_named(path, 1);
    }
  }
  unsigned count = 0;
  for (GuardedFile *file = live_files; file; file = file->next) {
    if (++count > LIVE_FILE_LIMIT) refuse();
    if (file->name[0]) {
      if (!matches(file->descriptor, file->name, 0, 1)) refuse();
    } else {
      struct stat anonymous;
      if (fstat(file->descriptor, &anonymous) || !S_ISREG(anonymous.st_mode) ||
          anonymous.st_uid != selected_owner || anonymous.st_nlink != 0 ||
          (anonymous.st_mode & 077)) refuse();
    }
    if (file->shared_descriptor >= 0) {
      if (snprintf(path, sizeof(path), "%s-shm", file->name) >= (int)sizeof(path) ||
          !matches(file->shared_descriptor, path, 0, 1)) refuse();
    }
  }
}

static int integer_field(const char *text) {
  char *end;
  errno = 0;
  long value = strtol(text, &end, 10);
  if (errno || end == text || value < 0 || value > INT_MAX || (*end != ',' && *end != '}')) refuse();
  return (int)value;
}

/* Borrow the actual pinned Unix VFS descriptors. Never guess unixFile layout,
 * reopen/close a database pathname or release another SQLite connection's lock. */
static void descriptors(GuardedFile *file, int inspect_shared) {
  sqlite3_str *builder = sqlite3_str_new(NULL);
  if (!builder) refuse();
  int result = file->real->pMethods->xFileControl(file->real, SQLITE_FCNTL_FILESTAT, builder);
  if (result != SQLITE_OK || sqlite3_str_length(builder) <= 0 || sqlite3_str_length(builder) > 8192) refuse();
  char *description = sqlite3_str_finish(builder);
  if (!description || strncmp(description, "{\"h\":", 5)) refuse();
  int actual = integer_field(description + 5);
  if (file->descriptor >= 0 && actual != file->descriptor) refuse();
  file->descriptor = actual;
  if (inspect_shared) {
    const char *shared = strstr(description, "\"shm\":{\"h\":");
    file->shared_descriptor = shared ? integer_field(shared + 11) : -1;
  }
  sqlite3_free(description);
}

#define PAIR(input) GuardedFile *file = (GuardedFile *)(input); sqlite3_file *real = file->real
#define BEGIN() do { diagnostic_operation = __func__; lock_gate(); check_authority(); } while (0)
#define END_RESULT(expression) do { int result = (expression); check_authority(); unlock_gate(); return result; } while (0)

static int guarded_close(sqlite3_file *input) {
  PAIR(input); BEGIN();
  GuardedFile **entry = &live_files;
  while (*entry && *entry != file) entry = &(*entry)->next;
  if (!*entry) refuse();
  *entry = file->next;
  int result = real->pMethods->xClose(real);
  free(real);
  file->real = NULL;
  file->base.pMethods = NULL;
  check_authority();
  unlock_gate();
  return result;
}

static int guarded_read(sqlite3_file *input, void *bytes, int count, sqlite3_int64 offset) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xRead(real, bytes, count, offset));
}
static int guarded_write(sqlite3_file *input, const void *bytes, int count, sqlite3_int64 offset) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xWrite(real, bytes, count, offset));
}
static int guarded_truncate(sqlite3_file *input, sqlite3_int64 bytes) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xTruncate(real, bytes));
}
static int guarded_sync(sqlite3_file *input, int flags) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xSync(real, flags));
}
static int guarded_size(sqlite3_file *input, sqlite3_int64 *bytes) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xFileSize(real, bytes));
}
static int guarded_lock(sqlite3_file *input, int flags) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xLock(real, flags));
}
static int guarded_unlock(sqlite3_file *input, int flags) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xUnlock(real, flags));
}
static int guarded_reserved(sqlite3_file *input, int *locked) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xCheckReservedLock(real, locked));
}
static int guarded_control(sqlite3_file *input, int operation, void *argument) {
  PAIR(input); BEGIN();
  if (operation == SQLITE_FCNTL_MMAP_SIZE) *(sqlite3_int64 *)argument = 0;
  END_RESULT(real->pMethods->xFileControl(real, operation, argument));
}
static int guarded_sector(sqlite3_file *input) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xSectorSize(real));
}
static int guarded_characteristics(sqlite3_file *input) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xDeviceCharacteristics(real));
}
static int guarded_shm_map(sqlite3_file *input, int page, int size, int extend, void volatile **mapping) {
  PAIR(input); BEGIN();
  int result = real->pMethods->xShmMap(real, page, size, extend, mapping);
  descriptors(file, 1);
  if (result == SQLITE_OK && *mapping && file->shared_descriptor < 0) refuse();
  check_authority();
  unlock_gate();
  return result;
}
static int guarded_shm_lock(sqlite3_file *input, int offset, int count, int flags) {
  PAIR(input); BEGIN(); END_RESULT(real->pMethods->xShmLock(real, offset, count, flags));
}
static void guarded_shm_barrier(sqlite3_file *input) {
  PAIR(input); BEGIN(); real->pMethods->xShmBarrier(real); check_authority(); unlock_gate();
}
static int guarded_shm_unmap(sqlite3_file *input, int remove_file) {
  PAIR(input); BEGIN();
  file->shared_descriptor = -1;
  END_RESULT(real->pMethods->xShmUnmap(real, remove_file));
}
static int guarded_fetch(sqlite3_file *input, sqlite3_int64 offset, int bytes, void **mapping) {
  (void)input; (void)offset; (void)bytes;
  BEGIN(); *mapping = NULL; unlock_gate(); return SQLITE_OK;
}
static int guarded_unfetch(sqlite3_file *input, sqlite3_int64 offset, void *mapping) {
  (void)input; (void)offset; (void)mapping;
  BEGIN(); unlock_gate(); return SQLITE_OK;
}
static const sqlite3_io_methods methods = {
  3, guarded_close, guarded_read, guarded_write, guarded_truncate, guarded_sync,
  guarded_size, guarded_lock, guarded_unlock, guarded_reserved, guarded_control,
  guarded_sector, guarded_characteristics, guarded_shm_map, guarded_shm_lock,
  guarded_shm_barrier, guarded_shm_unmap, guarded_fetch, guarded_unfetch
};

static int guarded_open(sqlite3_vfs *vfs, const char *name, sqlite3_file *input, int flags, int *output_flags) {
  (void)vfs; BEGIN();
  int database = -1;
  const char *suffix = NULL;
  int anonymous = !name && (flags & SQLITE_OPEN_DELETEONCLOSE) &&
      (flags & (SQLITE_OPEN_TEMP_DB | SQLITE_OPEN_TRANSIENT_DB |
                SQLITE_OPEN_TEMP_JOURNAL | SQLITE_OPEN_SUBJOURNAL));
  /* Anonymous Unix scratch files must already be unlinked and owner-only.
   * Named managed files retain the explicit seven-database/journal allowlist. */
  if (!anonymous && !filename(name, &database, &suffix)) refuse();
#ifdef HIVE_CANONICAL_SQLITE_TEST
  if (anonymous) anonymous_opens++;
#endif
  if (!anonymous && ((flags & SQLITE_OPEN_MAIN_DB) ? *suffix != '\0' :
      ((flags & SQLITE_OPEN_WAL) ? strcmp(suffix, "-wal") != 0 :
       !(flags & SQLITE_OPEN_MAIN_JOURNAL) || strcmp(suffix, "-journal") != 0))) refuse();
  if (!anonymous) check_named(name, 1);
  GuardedFile *file = (GuardedFile *)input;
  memset(file, 0, sizeof(*file));
  file->descriptor = file->shared_descriptor = -1;
  file->real = calloc(1, (size_t)parent_vfs->szOsFile);
  if (!file->real) { unlock_gate(); return SQLITE_NOMEM; }
  int result = parent_vfs->xOpen(parent_vfs, name, file->real, flags, output_flags);
  if (result != SQLITE_OK) {
    check_authority();
    if (file->real->pMethods) file->real->pMethods->xClose(file->real);
    free(file->real);
    file->real = NULL;
    check_authority();
    unlock_gate();
    return result;
  }
  if (file->real->pMethods->iVersion < 3 || (name && strlen(name) >= sizeof(file->name))) refuse();
  if (name) strcpy(file->name, name);
  descriptors(file, 0);
  if (!anonymous && !matches(file->descriptor, file->name, 0, 1)) refuse();
  if (!anonymous && !*suffix && database_pins[database] < 0) {
    /* At most seven duplicates; held until _exit/OS disposal. Closing an extra
     * descriptor while any SQLite connection owns POSIX locks is forbidden. */
    database_pins[database] = fcntl(file->descriptor, F_DUPFD_CLOEXEC, 3);
    if (database_pins[database] < 0) refuse();
  }
  file->next = live_files;
  live_files = file;
  file->base.pMethods = &methods;
  check_authority();
  unlock_gate();
  return SQLITE_OK;
}
static int guarded_delete(sqlite3_vfs *vfs, const char *name, int synchronize) {
  (void)vfs; BEGIN(); check_named(name, 1);
  END_RESULT(parent_vfs->xDelete(parent_vfs, name, synchronize));
}
static int guarded_access(sqlite3_vfs *vfs, const char *name, int flags, int *exists) {
  (void)vfs; BEGIN(); check_named(name, 1);
  END_RESULT(parent_vfs->xAccess(parent_vfs, name, flags, exists));
}

/* Trace admission remains installed when native quick-check/reclamation changes
 * its independent deadline progress handler. Never log SQL or ignore refusal. */
static int trace(unsigned event, void *context, void *statement, void *detail) {
  (void)event; (void)context; (void)statement; (void)detail;
  BEGIN(); unlock_gate(); return 0;
}
static int automatic(sqlite3 *connection, char **error, const sqlite3_api_routines *api) {
  (void)error; (void)api;
  sqlite3_vfs *actual = NULL;
  if (sqlite3_file_control(connection, "main", SQLITE_FCNTL_VFS_POINTER, &actual) != SQLITE_OK ||
      actual != &selected_vfs) return SQLITE_OK;
  BEGIN(); unlock_gate();
  if (sqlite3_trace_v2(connection, SQLITE_TRACE_STMT | SQLITE_TRACE_ROW | SQLITE_TRACE_PROFILE,
                       trace, NULL) != SQLITE_OK) refuse();
  return SQLITE_OK;
}

/* Called only after final configuration admission, before selected connections.
 * This experimental input is not active until the checked source recipe adds it. */
int hive_canonical_sqlite_vfs(const char *root) {
  lock_gate();
  if (initialized) {
    if (!root || strcmp(root, selected_root)) refuse();
    check_authority();
    unlock_gate();
    return SQLITE_OK;
  }
  if (!root || root[0] != '/' || !root[1] || strlen(root) >= sizeof(selected_root)) refuse();
  const char *part = root + 1;
  for (const char *cursor = part; ; cursor++) {
    if (*cursor && *cursor != '/') continue;
    size_t length = (size_t)(cursor - part);
    if (!length || (length == 1 && part[0] == '.') ||
        (length == 2 && part[0] == '.' && part[1] == '.')) refuse();
    if (!*cursor) break;
    part = cursor + 1;
  }
  selected_owner = geteuid();
  strcpy(selected_root, root);
  for (int index = 0; index < DATABASE_COUNT; index++) {
    database_pins[index] = database_leases[index] = -1;
  }
  char prefix[PATH_MAX];
  size_t bytes = strlen(root);
  for (size_t end = 1; end <= bytes; end++) {
    if (end < bytes && root[end] != '/') continue;
    if (ancestor_count >= ANCESTOR_COUNT || (end > 1 && root[end - 1] == '/')) refuse();
    memcpy(prefix, root, end);
    prefix[end] = '\0';
    int descriptor = open(prefix, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (descriptor < 0 || !matches(descriptor, prefix, 1, end == bytes)) refuse();
    ancestors[ancestor_count] = descriptor;
    ancestor_ends[ancestor_count++] = end;
  }
  /* Pin existing main databases before any managed connection opens. Do not
   * close these extra descriptors until process disposal: POSIX locks belong
   * to the process and closing any descriptor for the inode can release them. */
  for (int index = 0; index < DATABASE_COUNT; index++) {
    char leaf[128];
    if (snprintf(leaf, sizeof(leaf), ".%s.authority", database_names[index]) >= (int)sizeof(leaf) ||
        snprintf(prefix, sizeof(prefix), "%s/%s", selected_root, leaf) >= (int)sizeof(prefix)) refuse();
    int lease = openat(ancestors[ancestor_count - 1], leaf,
                       O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0600);
    struct stat info;
    if (!matches(lease, prefix, 0, 1) || fstat(lease, &info) || (info.st_mode & 077) ||
        flock(lease, LOCK_SH | LOCK_NB)) refuse();
    database_leases[index] = lease;
    if (snprintf(prefix, sizeof(prefix), "%s/%s", selected_root, database_names[index]) >= (int)sizeof(prefix)) refuse();
    check_named(prefix, 1);
    if (lstat(prefix, &info)) {
      if (errno == ENOENT) continue;
      refuse();
    }
    int descriptor = open(prefix, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (!matches(descriptor, prefix, 0, 1)) refuse();
    database_pins[index] = descriptor;
  }
  parent_vfs = sqlite3_vfs_find("unix");
  if (!parent_vfs || parent_vfs->iVersion < 3) refuse();
  selected_vfs = *parent_vfs;
  selected_vfs.zName = "hive-canonical-sqlite";
  selected_vfs.szOsFile = (int)sizeof(GuardedFile);
  selected_vfs.xOpen = guarded_open;
  selected_vfs.xDelete = guarded_delete;
  selected_vfs.xAccess = guarded_access;
  check_authority();
  if (sqlite3_vfs_register(&selected_vfs, 0) != SQLITE_OK ||
      sqlite3_auto_extension((void (*)(void))automatic) != SQLITE_OK) refuse();
  initialized = 1;
  unlock_gate();
  return SQLITE_OK;
}

static void backup_directory(int descriptor, const char *path) {
  struct stat info;
  if (!matches(descriptor, path, 1, 0) || fstat(descriptor, &info) ||
      info.st_uid != selected_owner || (info.st_mode & 022)) refuse();
}

/* A selected process holds seven stable shared leases for its lifetime. Native
 * recovery may replace one database only after all of this process's matching
 * handles close and an exclusive lease excludes cooperating native peers.
 * Keep the whole finite transition under the gate and use held directory fds:
 * an async sequence of pathname renames could operate in a replaced directory.
 * Ordinary native recovery retains its upstream implementation. */
int hive_canonical_sqlite_backup(const char *path, char *relative, size_t capacity, unsigned *moved) {
  BEGIN();
  int database;
  const char *suffix;
  if (!initialized || !relative || capacity < 128 || !moved ||
      !filename(path, &database, &suffix) || *suffix) refuse();
  *moved = 0;
  for (GuardedFile *file = live_files; file; file = file->next) {
    int actual;
    const char *ending;
    if (filename(file->name, &actual, &ending) && actual == database) {
      unlock_gate();
      return SQLITE_BUSY;
    }
  }
  if (flock(database_leases[database], LOCK_EX | LOCK_NB)) {
    int unavailable = errno == EWOULDBLOCK || errno == EAGAIN;
    /* Failed flock conversion releases the old shared lock. Restore it before
     * allowing normal operations; a competing recovery instead forces refusal. */
    if (flock(database_leases[database], LOCK_SH | LOCK_NB) || !unavailable) refuse();
    check_authority();
    unlock_gate();
    return SQLITE_BUSY;
  }
  check_authority();
  int root = ancestors[ancestor_count - 1];
  char parent_name[PATH_MAX], backup_name[PATH_MAX];
  if (snprintf(parent_name, sizeof(parent_name), "%s/db-backups", selected_root) >= (int)sizeof(parent_name)) refuse();
  if (mkdirat(root, "db-backups", 0700) && errno != EEXIST) refuse();
  check_authority();
  int parent = openat(root, "db-backups", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  backup_directory(parent, parent_name);
  unsigned attempt;
  char leaf[128];
  for (attempt = 0; attempt < 100; attempt++) {
    if (backup_sequence == UINT_MAX) refuse();
    int bytes = snprintf(leaf, sizeof(leaf), "sqlite-%lld-%ld-%u",
                         (long long)time(NULL), (long)getpid(), backup_sequence++);
    if (bytes < 0 || bytes >= (int)sizeof(leaf)) refuse();
    check_authority();
    backup_directory(parent, parent_name);
    if (!mkdirat(parent, leaf, 0700)) break;
    if (errno != EEXIST) refuse();
  }
  if (attempt == 100 || snprintf(relative, capacity, "db-backups/%s", leaf) >= (int)capacity ||
      snprintf(backup_name, sizeof(backup_name), "%s/%s", parent_name, leaf) >= (int)sizeof(backup_name)) refuse();
  int backup = openat(parent, leaf, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  backup_directory(backup, backup_name);
  int original_pin = database_pins[database];
  database_pins[database] = -1;
  for (int index = 0; index < 4; index++) {
    const char *ending = (const char *[]) { "", "-wal", "-shm", "-journal" }[index];
    char source_leaf[128], source[PATH_MAX], destination[PATH_MAX];
    if (snprintf(source_leaf, sizeof(source_leaf), "%s%s", database_names[database], ending) >= (int)sizeof(source_leaf) ||
        snprintf(source, sizeof(source), "%s/%s", selected_root, source_leaf) >= (int)sizeof(source) ||
        snprintf(destination, sizeof(destination), "%s/%s", backup_name, source_leaf) >= (int)sizeof(destination)) refuse();
    check_authority();
    backup_directory(parent, parent_name);
    backup_directory(backup, backup_name);
    struct stat info;
    if (lstat(source, &info)) {
      if (errno == ENOENT && (index || original_pin < 0)) continue;
      refuse();
    }
    int descriptor = index == 0 && original_pin >= 0 ? original_pin :
        openat(root, source_leaf, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (!matches(descriptor, source, 0, 1) || fsync(descriptor)) refuse();
    check_authority();
    backup_directory(parent, parent_name);
    backup_directory(backup, backup_name);
    if (renameat2(root, source_leaf, backup, source_leaf, RENAME_NOREPLACE) ||
        !matches(descriptor, destination, 0, 1)) refuse();
    *moved |= 1U << index;
    check_authority();
    backup_directory(parent, parent_name);
    backup_directory(backup, backup_name);
    if (descriptor != original_pin && close(descriptor)) refuse();
  }
  for (int index = 0; index < 4; index++) {
    char source[PATH_MAX];
    const char *ending = (const char *[]) { "", "-wal", "-shm", "-journal" }[index];
    struct stat info;
    if (snprintf(source, sizeof(source), "%s/%s%s", selected_root, database_names[database], ending) >= (int)sizeof(source) ||
        !lstat(source, &info) || errno != ENOENT) refuse();
  }
  if (!*moved || fsync(backup) || fsync(parent) || fsync(root)) refuse();
  check_authority();
  backup_directory(parent, parent_name);
  backup_directory(backup, backup_name);
  if ((original_pin >= 0 && close(original_pin)) || close(backup) || close(parent) ||
      flock(database_leases[database], LOCK_SH | LOCK_NB)) refuse();
  check_authority();
  unlock_gate();
  return SQLITE_OK;
}
