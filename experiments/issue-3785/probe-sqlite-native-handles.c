/* Bounded pinned-SQLite API control. This is not a production VFS. */
#define _GNU_SOURCE
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *root;
static char database[4096];
static int root_fd, main_fd = -1, shm_fd = -1;
static unsigned callbacks, installed;

/* FILESTAT accepts a sqlite3_str builder, not a char**. Only the pinned Unix
 * implementation's bounded descriptor fields are consumed; no private C ABI. */
static void descriptors(sqlite3 *connection) {
  sqlite3_str *builder = sqlite3_str_new(connection);
  assert(builder);
  int result = sqlite3_file_control(connection, "main", SQLITE_FCNTL_FILESTAT, builder);
  assert(result == SQLITE_OK && sqlite3_str_length(builder) < 8192);
  char *description = sqlite3_str_finish(builder);
  assert(description && sscanf(description, "{\"h\":%d", &main_fd) == 1 && main_fd >= 0);
  const char *shared = strstr(description, "\"shm\":{\"h\":");
  if (shared) assert(sscanf(shared, "\"shm\":{\"h\":%d", &shm_fd) == 1 && shm_fd >= 0);
  sqlite3_free(description);
}

static int same(int descriptor, const char *name, int directory) {
  struct stat held, named;
  return fstat(descriptor, &held) == 0 && lstat(name, &named) == 0 &&
      held.st_dev == named.st_dev && held.st_ino == named.st_ino &&
      held.st_uid == geteuid() && named.st_uid == geteuid() &&
      (directory ? S_ISDIR(named.st_mode) && !(named.st_mode & 077) :
       S_ISREG(named.st_mode) && named.st_nlink == 1 && !(named.st_mode & 022));
}

static int progress(void *unused) {
  (void)unused;
  assert(++callbacks < 10000);
  return !(same(root_fd, root, 1) && same(main_fd, database, 0));
}

static int automatic(sqlite3 *connection, char **error, const sqlite3_api_routines *api) {
  (void)error; (void)api;
  /* The real adapter must additionally distinguish its selected VFS. This
   * component control uses a single explicit connection and an ordinary peer. */
  const char *filename = sqlite3_db_filename(connection, "main");
  if (!filename || strcmp(filename, database)) return SQLITE_OK;
  descriptors(connection);
  sqlite3_progress_handler(connection, 1, progress, NULL);
  installed++;
  return SQLITE_OK;
}

int main(int argc, char **argv) {
  assert(argc == 3);
  umask(077);
  root = argv[1];
  int initial = strcmp(argv[2], "initial") == 0;
  assert(initial || strcmp(argv[2], "retained") == 0);
  assert(snprintf(database, sizeof(database), "%s/state.sqlite", root) < (int)sizeof(database));
  root_fd = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  assert(root_fd >= 0);
  assert(sqlite3_auto_extension((void (*)(void))automatic) == SQLITE_OK);
  sqlite3 *selected = NULL, *ordinary = NULL;
  assert(sqlite3_open(":memory:", &ordinary) == SQLITE_OK);
  assert(installed == 0);
  assert(sqlite3_exec(ordinary, "CREATE TABLE ordinary(value)", NULL, NULL, NULL) == SQLITE_OK);
  assert(callbacks == 0);
  assert(sqlite3_open(database, &selected) == SQLITE_OK);
  assert(installed == 1 && callbacks == 0 && main_fd >= 0);
  if (!initial) {
    assert(sqlite3_exec(selected, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE synthetic(value); INSERT INTO synthetic VALUES (1)", NULL, NULL, NULL) == SQLITE_OK);
    descriptors(selected);
    char shared[4096];
    assert(snprintf(shared, sizeof(shared), "%s-shm", database) < (int)sizeof(shared));
    assert(shm_fd >= 0 && same(shm_fd, shared, 0));
  }
  unsigned before = callbacks;
  printf("READY %s installed=%u borrowedMain=1 borrowedShm=%d before=%u\n", sqlite3_libversion(), installed, shm_fd >= 0, before);
  fflush(stdout);
  assert(getchar() == '\n');
  int result = sqlite3_exec(selected, initial ?
      "PRAGMA journal_mode=WAL; CREATE TABLE first(value)" :
      "SELECT * FROM synthetic", NULL, NULL, NULL);
  assert(callbacks > before);
  assert(sqlite3_close(selected) == SQLITE_OK);
  /* No independently opened database descriptor was closed while SQLite held
   * locks. The sole SQLite-owned descriptor is closed by SQLite itself. */
  errno = 0;
  assert(fcntl(main_fd, F_GETFD) == -1 && errno == EBADF);
  assert(sqlite3_exec(ordinary, "INSERT INTO ordinary VALUES (2)", NULL, NULL, NULL) == SQLITE_OK);
  assert(sqlite3_close(ordinary) == SQLITE_OK);
  assert(sqlite3_cancel_auto_extension((void (*)(void))automatic) == 1);
  close(root_fd);
  printf("RESULT code=%d callbacks=%u ordinary=1 sqliteOwnsClose=1\n", result, callbacks);
  return 0;
}
