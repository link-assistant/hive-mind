/* Synthetic component driver; no production executable or credentials. */
#define _GNU_SOURCE
#include <assert.h>
#include <pthread.h>
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int hive_canonical_sqlite_vfs(const char *root);
unsigned hive_canonical_sqlite_test_anonymous(void);
static unsigned native_progress;
static char shared_path[4096];
static int deadline_progress(void *unused) { (void)unused; native_progress++; return 0; }
static void checked(sqlite3 *connection, const char *sql) {
  char *error = NULL;
  int result = sqlite3_exec(connection, sql, NULL, NULL, &error);
  if (result) fprintf(stderr, "Synthetic SQLite error %d: %s\n", result, error ? error : "unavailable");
  sqlite3_free(error);
  assert(result == SQLITE_OK);
}

static void *peer(void *unused) {
  (void)unused;
  sqlite3 *connection = NULL;
  assert(sqlite3_open_v2(shared_path, &connection, SQLITE_OPEN_READWRITE,
                          "hive-canonical-sqlite") == SQLITE_OK);
  sqlite3_busy_timeout(connection, 2000);
  for (int row = 0; row < 25; row++)
    checked(connection, "INSERT INTO synthetic VALUES (3)");
  assert(sqlite3_close(connection) == SQLITE_OK);
  return NULL;
}

int main(int argc, char **argv) {
  assert(argc == 4);
  umask(077);
  assert(setenv("CODEX_ROLLOUT_HOME", argv[1], 1) == 0);
  assert(setenv("CODEX_SQLITE_HOME", argv[1], 1) == 0);
  assert(hive_canonical_sqlite_vfs(argv[1]) == SQLITE_OK);
  char path[4096];
  assert(snprintf(path, sizeof(path), "%s/%s", argv[1], argv[2]) < (int)sizeof(path));
  sqlite3 *connection = NULL, *ordinary = NULL;
  assert(sqlite3_open(":memory:", &ordinary) == SQLITE_OK);
  checked(ordinary, "CREATE TABLE ordinary(value); INSERT INTO ordinary VALUES (1)");
  assert(sqlite3_open_v2(path, &connection, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                          "hive-canonical-sqlite") == SQLITE_OK);
  sqlite3_busy_timeout(connection, 1000);
  sqlite3_progress_handler(connection, 1, deadline_progress, NULL);
  int initial = strcmp(argv[3], "initial") == 0;
  int closed = strcmp(argv[3], "reopen") == 0;
  int rebuild = strcmp(argv[3], "rebuild") == 0;
  int transaction = strcmp(argv[3], "transaction") == 0;
  int read_only = strcmp(argv[3], "read-only") == 0;
  if (!initial) {
    checked(connection, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE IF NOT EXISTS synthetic(value); INSERT INTO synthetic VALUES (1)");
    sqlite3_progress_handler(connection, 1, deadline_progress, NULL);
    checked(connection, "SELECT * FROM synthetic");
    assert(native_progress > 0);
    sqlite3_progress_handler(connection, 0, NULL, NULL);
    if (transaction) checked(connection, "BEGIN IMMEDIATE; SELECT * FROM synthetic");
    if (closed || read_only || rebuild) {
      assert(sqlite3_close(connection) == SQLITE_OK);
      connection = NULL;
    }
    if (read_only)
      assert(sqlite3_open_v2(path, &connection, SQLITE_OPEN_READONLY, "hive-canonical-sqlite") == SQLITE_OK);
  }
  printf("READY %s\n", sqlite3_libversion());
  fflush(stdout);
  assert(getchar() == '\n');
  if (rebuild) {
    char backup[4096];
    assert(snprintf(backup, sizeof(backup), "%s/retired-main", argv[1]) < (int)sizeof(backup));
    assert(rename(path, backup) == 0);
    assert(sqlite3_open_v2(path, &connection, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                            "hive-canonical-sqlite") == SQLITE_OK);
    initial = 1;
  }
  if (closed)
    assert(sqlite3_open_v2(path, &connection, SQLITE_OPEN_READWRITE, "hive-canonical-sqlite") == SQLITE_OK);
  if (strcmp(argv[3], "threads") == 0) {
    strcpy(shared_path, path);
    pthread_t workers[3];
    for (int index = 0; index < 3; index++) assert(pthread_create(&workers[index], NULL, peer, NULL) == 0);
    for (int index = 0; index < 3; index++) assert(pthread_join(workers[index], NULL) == 0);
  }
  if (strcmp(argv[3], "concurrent") == 0)
    for (int row = 0; row < 50; row++) checked(connection, "INSERT INTO synthetic VALUES (4)");
  if (strcmp(argv[3], "scratch") == 0) {
    /* Force a file-backed temporary table and a rollback subjournal while the
     * main connection continues to use its selected authority. */
    checked(connection, "PRAGMA temp_store=FILE; PRAGMA temp.cache_size=1; CREATE TEMP TABLE scratch(value); WITH RECURSIVE input(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM input WHERE value<64) INSERT INTO scratch SELECT zeroblob(2048) FROM input; SELECT COUNT(*) FROM scratch; DROP TABLE scratch");
    assert(hive_canonical_sqlite_test_anonymous() > 0);
  }
  if (strcmp(argv[3], "close-only")) {
    checked(connection, initial ? "PRAGMA journal_mode=WAL; CREATE TABLE first(value)" : "SELECT * FROM synthetic");
    if (transaction) checked(connection, "INSERT INTO synthetic VALUES (2); COMMIT");
    else if (!read_only && !initial) checked(connection, "INSERT INTO synthetic VALUES (2)");
  }
  assert(sqlite3_close(connection) == SQLITE_OK);
  checked(ordinary, "INSERT INTO ordinary VALUES (2)");
  assert(sqlite3_close(ordinary) == SQLITE_OK);
  puts("RESULT selected=1 ordinary=1 nativeProgress=1 close=1");
  return 0;
}
