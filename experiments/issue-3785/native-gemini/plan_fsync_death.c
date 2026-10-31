// Synthetic Linux-only filesystem kill points for the complete native CLI.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

// A finite interrupted write leaves half of the small publication proof durable.
ssize_t write(int fd, const void *buffer, size_t length) {
  static ssize_t (*original_write)(int, const void *, size_t);
  if (!original_write) {
    *(void **)(&original_write) = dlsym(RTLD_NEXT, "write");
    if (!original_write) _exit(125);
  }
  const char *point = getenv("SYNTHETIC_GEMINI_PLAN_CRASH_POINT");
  const char *root = getenv("SYNTHETIC_GEMINI_PLAN_CRASH_ROOT");
  const char *marker = getenv("SYNTHETIC_GEMINI_PLAN_CRASH_MARKER");
  if (point && !strcmp(point, "partial-intent-journal") && root && marker &&
      length > 32 && length <= 4096 &&
      memmem(buffer, length, "\"name\":\".plan-transaction.json\"", 31)) {
    char link[64], location[PATH_MAX];
    snprintf(link, sizeof(link), "/proc/self/fd/%d", fd);
    ssize_t count = readlink(link, location, sizeof(location) - 1);
    if (count > 0) {
      location[count] = 0;
      size_t prefix = strlen(root);
      if (!strncmp(location, root, prefix) && location[prefix] == '/' &&
          strstr(location + prefix, "/plans/session-") &&
          (strstr(location, "/.publish-") || strstr(location, ".journal.tmp"))) {
        ssize_t partial = original_write(fd, buffer, length / 2);
        if (partial != (ssize_t)(length / 2) || fsync(fd)) _exit(126);
        int proof = open(marker, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
        if (proof < 0) _exit(126);
        ssize_t written = original_write(proof, point, strlen(point));
        if (written != (ssize_t)strlen(point) || fsync(proof)) _exit(126);
        close(proof);
        kill(getpid(), SIGKILL);
        _exit(127);
      }
    }
  }
  return original_write(fd, buffer, length);
}

static int contains(int directory, const char *name, const char *needle) {
  int fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  if (fd < 0) return 0;
  struct stat info;
  int found = 0;
  size_t length = strlen(needle), kept = 0;
  char bytes[4224];
  if (length == 0 || length > 128 || fstat(fd, &info) ||
      !S_ISREG(info.st_mode) || info.st_size > 33554432) goto finish;
  for (off_t read_total = 0; read_total < info.st_size;) {
    ssize_t count = read(fd, bytes + kept, 4096);
    if (count <= 0) break;
    read_total += count;
    size_t available = kept + (size_t)count;
    if (memmem(bytes, available, needle, length)) { found = 1; break; }
    kept = available < length - 1 ? available : length - 1;
    memmove(bytes, bytes + available - kept, kept);
  }
finish:
  close(fd);
  return found;
}

int fsync(int fd) {
  static int (*synchronize)(int);
  if (!synchronize) {
    *(void **)(&synchronize) = dlsym(RTLD_NEXT, "fsync");
    if (!synchronize) _exit(125);
  }
  int result = synchronize(fd), saved = errno;
  const char *root = getenv("SYNTHETIC_GEMINI_PLAN_CRASH_ROOT");
  const char *point = getenv("SYNTHETIC_GEMINI_PLAN_CRASH_POINT");
  const char *needle = getenv("SYNTHETIC_GEMINI_PLAN_CRASH_NEEDLE");
  const char *marker = getenv("SYNTHETIC_GEMINI_PLAN_CRASH_MARKER");
  if (result || !root || !point || !needle || !marker) goto finish;
  char link[64], location[PATH_MAX];
  snprintf(link, sizeof(link), "/proc/self/fd/%d", fd);
  ssize_t count = readlink(link, location, sizeof(location) - 1);
  struct stat info;
  if (count <= 0 || fstat(fd, &info) || !S_ISDIR(info.st_mode)) goto finish;
  location[count] = 0;
  size_t length = strlen(root);
  if (strncmp(location, root, length) || location[length] != '/') goto finish;
  int matches = 0;
  if (!strcmp(point, "after-journal") && strstr(location + length, "/message-history"))
    matches = contains(fd, "prompt-history.json", needle);
  if (strstr(location + length, "/plans/session-")) {
    if (!strcmp(point, "after-intent"))
      matches = contains(fd, ".plan-transaction.json", needle);
    if (!strcmp(point, "after-publish"))
      matches = contains(fd, "synthetic-retained-plan.md", needle);
  }
  if (matches) {
    int proof = open(marker, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (proof < 0) goto finish;
    ssize_t written = write(proof, point, strlen(point));
    int durable = synchronize(proof);
    close(proof);
    if (written != (ssize_t)strlen(point) || durable) _exit(126);
    kill(getpid(), SIGKILL);
    _exit(127);
  }
finish:
  errno = saved;
  return result;
}
