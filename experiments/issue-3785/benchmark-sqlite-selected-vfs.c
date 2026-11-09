/* Bounded pinned-component comparison. This does not benchmark the native CLI. */
#define _GNU_SOURCE
#include <assert.h>
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>

int hive_canonical_sqlite_vfs(const char *root);
static double milliseconds(void) {
  struct timespec now;
  assert(clock_gettime(CLOCK_MONOTONIC, &now) == 0);
  return now.tv_sec * 1000.0 + now.tv_nsec / 1000000.0;
}
static void checked(sqlite3 *connection, const char *sql) {
  assert(sqlite3_exec(connection, sql, NULL, NULL, NULL) == SQLITE_OK);
}

int main(int argc, char **argv) {
  assert(argc == 3);
  umask(077);
  int selected = strcmp(argv[2], "selected") == 0;
  assert(selected || strcmp(argv[2], "ordinary") == 0);
  double start = milliseconds();
  if (selected) {
    assert(setenv("CODEX_ROLLOUT_HOME", argv[1], 1) == 0);
    assert(setenv("CODEX_SQLITE_HOME", argv[1], 1) == 0);
    assert(hive_canonical_sqlite_vfs(argv[1]) == SQLITE_OK);
  }
  char path[4096];
  assert(snprintf(path, sizeof(path), "%s/state_5.sqlite", argv[1]) < (int)sizeof(path));
  sqlite3 *connection = NULL;
  assert(sqlite3_open_v2(path, &connection, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                          selected ? "hive-canonical-sqlite" : NULL) == SQLITE_OK);
  checked(connection, "PRAGMA journal_mode=WAL; CREATE TABLE synthetic(value); INSERT INTO synthetic VALUES (1)");
  double startup = milliseconds() - start;
  sqlite3_stmt *query = NULL;
  assert(sqlite3_prepare_v2(connection, "SELECT value FROM synthetic WHERE rowid=1", -1, &query, NULL) == SQLITE_OK);
  start = milliseconds();
  for (int index = 0; index < 1000; index++) {
    assert(sqlite3_step(query) == SQLITE_ROW && sqlite3_column_int(query, 0) == 1);
    assert(sqlite3_step(query) == SQLITE_DONE);
    assert(sqlite3_reset(query) == SQLITE_OK);
  }
  double queries = milliseconds() - start;
  assert(sqlite3_finalize(query) == SQLITE_OK);
  start = milliseconds();
  checked(connection, "BEGIN IMMEDIATE");
  for (int index = 0; index < 100; index++) checked(connection, "INSERT INTO synthetic VALUES (2)");
  checked(connection, "COMMIT");
  double writes = milliseconds() - start;
  start = milliseconds();
  assert(sqlite3_close(connection) == SQLITE_OK);
  printf("{\"mode\":\"%s\",\"startupMillis\":%.3f,\"queries\":1000,\"queryMillis\":%.3f,"
         "\"writes\":100,\"writeMillis\":%.3f,\"closeMillis\":%.3f}\n",
         argv[2], startup, queries, writes, milliseconds() - start);
  return 0;
}
