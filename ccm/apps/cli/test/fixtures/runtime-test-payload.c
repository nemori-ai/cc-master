#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>

#ifndef PAYLOAD_TEXT
#define PAYLOAD_TEXT "unset"
#endif

int main(int argc, char **argv) {
  if (argc != 2) {
    return 64;
  }
  int fd = open(argv[1], O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd < 0) {
    return errno > 0 && errno < 126 ? errno : 74;
  }
  const char *text = PAYLOAD_TEXT;
  size_t remaining = strlen(text);
  while (remaining > 0) {
    ssize_t written = write(fd, text, remaining);
    if (written < 0 && errno == EINTR) {
      continue;
    }
    if (written <= 0) {
      close(fd);
      return 74;
    }
    text += written;
    remaining -= (size_t)written;
  }
  if (close(fd) < 0) {
    return 74;
  }
  return 0;
}
