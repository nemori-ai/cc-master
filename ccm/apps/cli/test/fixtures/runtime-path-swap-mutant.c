#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <stdio.h>

int main(int argc, char **argv) {
  if (argc != 4) {
    return 64;
  }
  if (rename(argv[1], argv[3]) < 0) {
    return errno > 0 && errno < 126 ? errno : 74;
  }
  if (rename(argv[2], argv[1]) < 0) {
    int saved = errno;
    (void)rename(argv[3], argv[1]);
    return saved > 0 && saved < 126 ? saved : 74;
  }
  return 0;
}
