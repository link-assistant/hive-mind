/* Use the platform flock layout for a bounded POSIX-lock lifetime control. */
#include <fcntl.h>
#include <unistd.h>
int synthetic_database_lock(int descriptor) {
  struct flock lock = {0};
  lock.l_type = F_WRLCK;
  lock.l_whence = SEEK_SET;
  lock.l_len = 1;
  return fcntl(descriptor, F_SETLK, &lock);
}
