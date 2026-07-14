#define _GNU_SOURCE 1
#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>

#define CCM_RUNTIME_HELPER_CONTRACT "linux-exact-fd-v1"
#include "runtime-launcher-materializer.h"

extern char **environ;

enum {
  VERIFIED_IMAGE_FD = 3,
  ERROR_CONTROL_FD = 4,
  HELPER_FAILURE_EXIT = 125,
};

static int report_failure(const char *stage, int error_number) {
  char message[192];
  int length = snprintf(message, sizeof(message),
                        "CCM_RUNTIME_INVOKE_ERROR\tv1\t%s\t%d\n", stage,
                        error_number);
  if (length > 0) {
    size_t remaining = (size_t)length < sizeof(message) ? (size_t)length
                                                        : sizeof(message) - 1;
    const char *cursor = message;
    while (remaining > 0) {
      ssize_t written = write(ERROR_CONTROL_FD, cursor, remaining);
      if (written > 0) {
        cursor += written;
        remaining -= (size_t)written;
        continue;
      }
      if (written < 0 && errno == EINTR) {
        continue;
      }
      break;
    }
  }
  return HELPER_FAILURE_EXIT;
}

int main(int argc, char **argv) {
  int materializer_result = ccm_runtime_launcher_materializer_main(argc, argv);
  if (materializer_result >= 0) {
    return materializer_result;
  }
  if (argc < 2) {
    return report_failure("argv", EINVAL);
  }

  int control_flags = fcntl(ERROR_CONTROL_FD, F_GETFD);
  if (control_flags < 0 ||
      fcntl(ERROR_CONTROL_FD, F_SETFD, control_flags | FD_CLOEXEC) < 0) {
    return report_failure("control-fd", errno);
  }

  int image_flags = fcntl(VERIFIED_IMAGE_FD, F_GETFD);
  if (image_flags < 0 ||
      fcntl(VERIFIED_IMAGE_FD, F_SETFD, image_flags & ~FD_CLOEXEC) < 0) {
    return report_failure("image-fd", errno);
  }

  struct stat image_stat;
  if (fstat(VERIFIED_IMAGE_FD, &image_stat) < 0) {
    return report_failure("image-fstat", errno);
  }
  if (!S_ISREG(image_stat.st_mode)) {
    return report_failure("image-type", EINVAL);
  }

  /* argv[1] is diagnostic identity only; the kernel executes the pinned fd. */
  fexecve(VERIFIED_IMAGE_FD, &argv[1], environ);
  return report_failure("fexecve", errno);
}
