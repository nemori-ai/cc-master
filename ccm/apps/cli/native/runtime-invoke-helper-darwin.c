#define _DARWIN_C_SOURCE 1
#define _POSIX_C_SOURCE 200809L

#include <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define CCM_RUNTIME_HELPER_CONTRACT "darwin-path-attested-v1"
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

static int same_revision(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
         left->st_gen == right->st_gen && left->st_uid == right->st_uid &&
         left->st_mode == right->st_mode && left->st_size == right->st_size &&
         left->st_flags == right->st_flags &&
         left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec &&
         left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec &&
         left->st_ctimespec.tv_sec == right->st_ctimespec.tv_sec &&
         left->st_ctimespec.tv_nsec == right->st_ctimespec.tv_nsec;
}

static int valid_sha256(const char *value) {
  if (strlen(value) != CC_SHA256_DIGEST_LENGTH * 2) {
    return 0;
  }
  for (size_t index = 0; value[index] != '\0'; index++) {
    if (!((value[index] >= '0' && value[index] <= '9') ||
          (value[index] >= 'a' && value[index] <= 'f'))) {
      return 0;
    }
  }
  return 1;
}

static int hash_fd(int fd, char output[CC_SHA256_DIGEST_LENGTH * 2 + 1]) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  unsigned char buffer[64 * 1024];
  CC_SHA256_CTX context;
  if (lseek(fd, 0, SEEK_SET) < 0 || CC_SHA256_Init(&context) != 1) {
    return -1;
  }
  for (;;) {
    ssize_t count = read(fd, buffer, sizeof(buffer));
    if (count > 0) {
      if (CC_SHA256_Update(&context, buffer, (CC_LONG)count) != 1) {
        errno = EIO;
        return -1;
      }
      continue;
    }
    if (count == 0) {
      break;
    }
    if (errno != EINTR) {
      return -1;
    }
  }
  if (CC_SHA256_Final(digest, &context) != 1) {
    errno = EIO;
    return -1;
  }
  for (size_t index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) {
    (void)snprintf(&output[index * 2], 3, "%02x", digest[index]);
  }
  output[CC_SHA256_DIGEST_LENGTH * 2] = '\0';
  return 0;
}

int main(int argc, char **argv) {
  int materializer_result = ccm_runtime_launcher_materializer_main(argc, argv);
  if (materializer_result >= 0) {
    return materializer_result;
  }
  if (argc < 3 || !valid_sha256(argv[2])) {
    return report_failure("argv", EINVAL);
  }

  int control_flags = fcntl(ERROR_CONTROL_FD, F_GETFD);
  if (control_flags < 0 ||
      fcntl(ERROR_CONTROL_FD, F_SETFD, control_flags | FD_CLOEXEC) < 0) {
    return report_failure("control-fd", errno);
  }
  int image_flags = fcntl(VERIFIED_IMAGE_FD, F_GETFD);
  if (image_flags < 0 ||
      fcntl(VERIFIED_IMAGE_FD, F_SETFD, image_flags | FD_CLOEXEC) < 0) {
    return report_failure("image-fd", errno);
  }

  struct stat pinned_before;
  struct stat path_before;
  struct stat opened_before;
  if (fstat(VERIFIED_IMAGE_FD, &pinned_before) < 0) {
    return report_failure("pinned-fstat", errno);
  }
  if (lstat(argv[1], &path_before) < 0) {
    return report_failure("path-lstat", errno);
  }
  if (!S_ISREG(pinned_before.st_mode) || !S_ISREG(path_before.st_mode) ||
      (path_before.st_mode & S_IXUSR) == 0 || (path_before.st_mode & 0022) != 0) {
    return report_failure("path-policy", EINVAL);
  }

  int path_fd = open(argv[1], O_RDONLY | O_NOFOLLOW);
  if (path_fd < 0) {
    return report_failure("path-open", errno);
  }
  if (fstat(path_fd, &opened_before) < 0) {
    int saved = errno;
    close(path_fd);
    return report_failure("path-fstat", saved);
  }
  if (!same_revision(&pinned_before, &path_before) ||
      !same_revision(&pinned_before, &opened_before)) {
    close(path_fd);
    return report_failure("identity-check", EAGAIN);
  }

  char actual_sha256[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  if (hash_fd(path_fd, actual_sha256) < 0) {
    int saved = errno;
    close(path_fd);
    return report_failure("digest-read", saved);
  }
  if (strcmp(actual_sha256, argv[2]) != 0) {
    close(path_fd);
    return report_failure("digest-check", EINVAL);
  }

  struct stat pinned_after;
  struct stat opened_after;
  struct stat path_after;
  if (fstat(VERIFIED_IMAGE_FD, &pinned_after) < 0 ||
      fstat(path_fd, &opened_after) < 0 || lstat(argv[1], &path_after) < 0) {
    int saved = errno;
    close(path_fd);
    return report_failure("revision-recheck", saved);
  }
  if (!same_revision(&pinned_before, &pinned_after) ||
      !same_revision(&opened_before, &opened_after) ||
      !same_revision(&opened_after, &path_after)) {
    close(path_fd);
    return report_failure("revision-check", EAGAIN);
  }
  if (close(path_fd) < 0) {
    return report_failure("path-close", errno);
  }

  /* The kernel re-resolves this pathname after the final userspace checks, so
   * the advertised contract retains a same-UID replacement residual and never
   * claims exact-object execution. */
  argv[2] = argv[1];
  execve(argv[1], &argv[2], environ);
  return report_failure("execve", errno);
}
