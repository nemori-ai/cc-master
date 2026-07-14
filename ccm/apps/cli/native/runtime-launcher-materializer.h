#ifndef CCM_RUNTIME_LAUNCHER_MATERIALIZER_H
#define CCM_RUNTIME_LAUNCHER_MATERIALIZER_H

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#ifndef CCM_RUNTIME_HELPER_CONTRACT
#error "CCM_RUNTIME_HELPER_CONTRACT must be defined before including this header"
#endif

enum {
  CCM_MATERIALIZER_DIRECTORY_FD = 3,
  CCM_MATERIALIZER_CONTROL_FD = 4,
  CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD = 5,
  CCM_MATERIALIZER_BOOTSTRAP_INSTANCE_FD = 6,
  CCM_MATERIALIZER_BOOTSTRAP_FILE_FD = 7,
  CCM_MATERIALIZER_FAILURE_EXIT = 125,
  CCM_MATERIALIZER_MAX_BYTES = 64 * 1024 * 1024,
};

struct ccm_materializer_candidate_list {
  char **names;
  size_t count;
  size_t capacity;
};

static int ccm_materializer_report(const char *stage, int error_number) {
  char message[224];
  int length = snprintf(message, sizeof(message),
                        "CCM_RUNTIME_MATERIALIZE_ERROR\tv1\t%s\t%d\n", stage,
                        error_number);
  if (length > 0) {
    size_t remaining = (size_t)length < sizeof(message) ? (size_t)length
                                                        : sizeof(message) - 1;
    const char *cursor = message;
    while (remaining > 0) {
      ssize_t written = write(CCM_MATERIALIZER_CONTROL_FD, cursor, remaining);
      if (written > 0) {
        cursor += written;
        remaining -= (size_t)written;
      } else if (written < 0 && errno == EINTR) {
        continue;
      } else {
        break;
      }
    }
  }
  return CCM_MATERIALIZER_FAILURE_EXIT;
}

static int ccm_materializer_hex(char value) {
  return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f');
}

static int ccm_materializer_valid_sha256(const char *value) {
  if (strlen(value) != 64) {
    return 0;
  }
  for (size_t index = 0; index < 64; index++) {
    if (!ccm_materializer_hex(value[index])) {
      return 0;
    }
  }
  return 1;
}

static int ccm_materializer_valid_uuid(const char *value) {
  static const size_t hyphens[] = {8, 13, 18, 23};
  if (strlen(value) != 36) {
    return 0;
  }
  for (size_t index = 0; index < 36; index++) {
    int is_hyphen = 0;
    for (size_t cursor = 0; cursor < sizeof(hyphens) / sizeof(hyphens[0]);
         cursor++) {
      if (index == hyphens[cursor]) {
        is_hyphen = 1;
      }
    }
    if ((is_hyphen && value[index] != '-') ||
        (!is_hyphen && !ccm_materializer_hex(value[index]))) {
      return 0;
    }
  }
  return 1;
}

static int ccm_materializer_valid_candidate(const char *name, pid_t *pid_out) {
  char prefix[96];
  int prefix_length = snprintf(prefix, sizeof(prefix), ".%s-", CCM_RUNTIME_HELPER_CONTRACT);
  size_t name_length = strlen(name);
  if (prefix_length <= 0 || (size_t)prefix_length >= sizeof(prefix) ||
      name_length <= (size_t)prefix_length + 1 + 36 + 4 ||
      strncmp(name, prefix, (size_t)prefix_length) != 0 ||
      strcmp(name + name_length - 4, ".tmp") != 0) {
    return 0;
  }
  const char *pid_start = name + prefix_length;
  const char *separator = strchr(pid_start, '-');
  if (separator == NULL || separator == pid_start ||
      strlen(separator + 1) != 36 + 4) {
    return 0;
  }
  for (const char *cursor = pid_start; cursor < separator; cursor++) {
    if (*cursor < '0' || *cursor > '9') {
      return 0;
    }
  }
  errno = 0;
  char *pid_end = NULL;
  unsigned long parsed = strtoul(pid_start, &pid_end, 10);
  if (errno != 0 || pid_end != separator || parsed == 0 || parsed > INT32_MAX) {
    return 0;
  }
  char uuid[37];
  memcpy(uuid, separator + 1, 36);
  uuid[36] = '\0';
  if (!ccm_materializer_valid_uuid(uuid)) {
    return 0;
  }
  *pid_out = (pid_t)parsed;
  return 1;
}

static int ccm_materializer_valid_bootstrap_candidate(const char *name,
                                                      pid_t *pid_out) {
  char prefix[128];
  int prefix_length = snprintf(prefix, sizeof(prefix), ".materializer-%s-",
                               CCM_RUNTIME_HELPER_CONTRACT);
  size_t name_length = strlen(name);
  if (prefix_length <= 0 || (size_t)prefix_length >= sizeof(prefix) ||
      name_length <= (size_t)prefix_length + 1 + 36 + 4 ||
      strncmp(name, prefix, (size_t)prefix_length) != 0 ||
      strcmp(name + name_length - 4, ".tmp") != 0) {
    return 0;
  }
  const char *pid_start = name + prefix_length;
  const char *separator = strchr(pid_start, '-');
  if (separator == NULL || separator == pid_start ||
      strlen(separator + 1) != 36 + 4) {
    return 0;
  }
  for (const char *cursor = pid_start; cursor < separator; cursor++) {
    if (*cursor < '0' || *cursor > '9') {
      return 0;
    }
  }
  errno = 0;
  char *pid_end = NULL;
  unsigned long parsed = strtoul(pid_start, &pid_end, 10);
  if (errno != 0 || pid_end != separator || parsed == 0 ||
      parsed > INT32_MAX) {
    return 0;
  }
  char uuid[37];
  memcpy(uuid, separator + 1, 36);
  uuid[36] = '\0';
  if (!ccm_materializer_valid_uuid(uuid)) {
    return 0;
  }
  *pid_out = (pid_t)parsed;
  return 1;
}

static int ccm_materializer_dead_process(pid_t pid) {
  if (kill(pid, 0) == 0) {
    return 0;
  }
  if (errno == EPERM) {
    return 0;
  }
  if (errno == ESRCH) {
    return 1;
  }
  return -1;
}

static void ccm_materializer_free_candidates(
    struct ccm_materializer_candidate_list *list) {
  for (size_t index = 0; index < list->count; index++) {
    free(list->names[index]);
  }
  free(list->names);
  list->names = NULL;
  list->count = 0;
  list->capacity = 0;
}

static int ccm_materializer_add_candidate(
    struct ccm_materializer_candidate_list *list, const char *name) {
  if (list->count == list->capacity) {
    size_t next_capacity = list->capacity == 0 ? 8 : list->capacity * 2;
    if (next_capacity < list->capacity ||
        next_capacity > SIZE_MAX / sizeof(*list->names)) {
      errno = EOVERFLOW;
      return -1;
    }
    char **next = realloc(list->names, next_capacity * sizeof(*list->names));
    if (next == NULL) {
      return -1;
    }
    list->names = next;
    list->capacity = next_capacity;
  }
  list->names[list->count] = strdup(name);
  if (list->names[list->count] == NULL) {
    return -1;
  }
  list->count++;
  return 0;
}

static int ccm_materializer_write_ready(const char *ready_path) {
  if (ready_path == NULL || strcmp(ready_path, "-") == 0 || ready_path[0] != '/') {
    errno = EINVAL;
    return -1;
  }
  int fd = open(ready_path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  if (fd < 0) {
    return -1;
  }
  static const char ready[] = "ready\n";
  ssize_t written;
  do {
    written = write(fd, ready, sizeof(ready) - 1);
  } while (written < 0 && errno == EINTR);
  int saved = written == (ssize_t)(sizeof(ready) - 1) ? 0 : (written < 0 ? errno : EIO);
  if (close(fd) < 0 && saved == 0) {
    saved = errno;
  }
  if (saved != 0) {
    errno = saved;
    return -1;
  }
  return 0;
}

static int ccm_materializer_test_seam(const char *expected_point,
                                      const char *configured_point,
                                      const char *ready_path,
                                      const char *barrier_path,
                                      const char *action) {
  if (configured_point == NULL || strcmp(configured_point, expected_point) != 0) {
    return 0;
  }
  if (ccm_materializer_write_ready(ready_path) < 0) {
    return -1;
  }
  if (strcmp(action, "kill") == 0) {
    (void)kill(getpid(), SIGKILL);
    _exit(128 + SIGKILL);
  }
  if (strcmp(action, "pause") != 0 || barrier_path == NULL ||
      barrier_path[0] != '/') {
    errno = EINVAL;
    return -1;
  }
  struct timespec delay = {.tv_sec = 0, .tv_nsec = 5 * 1000 * 1000};
  for (size_t attempt = 0; attempt < 12000; attempt++) {
    struct stat barrier;
    if (lstat(barrier_path, &barrier) == 0) {
      return 0;
    }
    if (errno != ENOENT) {
      return -1;
    }
    (void)nanosleep(&delay, NULL);
  }
  errno = ETIMEDOUT;
  return -1;
}

static int ccm_materializer_snapshot_candidates(
    int directory_fd, struct ccm_materializer_candidate_list *list) {
  int duplicate = dup(directory_fd);
  if (duplicate < 0) {
    return -1;
  }
  DIR *directory = fdopendir(duplicate);
  if (directory == NULL) {
    int saved = errno;
    close(duplicate);
    errno = saved;
    return -1;
  }
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(directory);
    if (entry == NULL) {
      break;
    }
    pid_t publisher_pid = 0;
    if (!ccm_materializer_valid_candidate(entry->d_name, &publisher_pid)) {
      continue;
    }
    int dead = ccm_materializer_dead_process(publisher_pid);
    if (dead < 0 || (dead > 0 && ccm_materializer_add_candidate(list, entry->d_name) < 0)) {
      int saved = errno;
      closedir(directory);
      errno = saved;
      return -1;
    }
  }
  int saved = errno;
  if (closedir(directory) < 0 && saved == 0) {
    saved = errno;
  }
  if (saved != 0) {
    errno = saved;
    return -1;
  }
  return 0;
}

static int ccm_materializer_cleanup_candidates(
    int directory_fd, const struct ccm_materializer_candidate_list *list) {
  for (size_t index = 0; index < list->count; index++) {
    const char *name = list->names[index];
    struct stat entry;
    if (fstatat(directory_fd, name, &entry, AT_SYMLINK_NOFOLLOW) < 0) {
      if (errno == ENOENT) {
        continue;
      }
      return -1;
    }
    mode_t permissions = entry.st_mode & 0777;
    if (!S_ISREG(entry.st_mode) || entry.st_uid != geteuid() ||
        (permissions != 0600 && permissions != 0500)) {
      errno = EINVAL;
      return -1;
    }
    if (unlinkat(directory_fd, name, 0) < 0 && errno != ENOENT) {
      return -1;
    }
  }
  return 0;
}

static int ccm_materializer_same_object_identity(const struct stat *left,
                                                 const struct stat *right) {
  if (left->st_dev != right->st_dev || left->st_ino != right->st_ino ||
      left->st_uid != right->st_uid || left->st_mode != right->st_mode) {
    return 0;
  }
#if defined(__APPLE__)
  return left->st_gen == right->st_gen;
#else
  return 1;
#endif
}

static int ccm_materializer_same_file_revision(const struct stat *left,
                                               const struct stat *right) {
  if (!ccm_materializer_same_object_identity(left, right) ||
      left->st_size != right->st_size) {
    return 0;
  }
#if defined(__APPLE__)
  return left->st_flags == right->st_flags &&
         left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec &&
         left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec &&
         left->st_ctimespec.tv_sec == right->st_ctimespec.tv_sec &&
         left->st_ctimespec.tv_nsec == right->st_ctimespec.tv_nsec;
#else
  return left->st_mtim.tv_sec == right->st_mtim.tv_sec &&
         left->st_mtim.tv_nsec == right->st_mtim.tv_nsec &&
         left->st_ctim.tv_sec == right->st_ctim.tv_sec &&
         left->st_ctim.tv_nsec == right->st_ctim.tv_nsec;
#endif
}

/* A no-replace publisher creates final_name by hard-linking its sealed temp,
 * then removes that temp. A concurrent verifier can therefore observe one
 * exact immutable inode converging from two names to one. unlink(2) updates
 * ctime even though bytes and executable metadata are unchanged. This is the
 * only revision transition eligible for one bounded full re-verification. */
static int ccm_materializer_publish_link_converged(
    const struct stat *left, const struct stat *right) {
  if (!ccm_materializer_same_object_identity(left, right) ||
      left->st_size != right->st_size || left->st_nlink != 2 ||
      right->st_nlink != 1) {
    return 0;
  }
#if defined(__APPLE__)
  return left->st_flags == right->st_flags &&
         left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec &&
         left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec;
#else
  return left->st_mtim.tv_sec == right->st_mtim.tv_sec &&
         left->st_mtim.tv_nsec == right->st_mtim.tv_nsec;
#endif
}

static int ccm_materializer_read_exact(int fd, unsigned char *bytes, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = read(fd, bytes + offset, length - offset);
    if (count > 0) {
      offset += (size_t)count;
    } else if (count < 0 && errno == EINTR) {
      continue;
    } else {
      errno = count == 0 ? EINVAL : errno;
      return -1;
    }
  }
  unsigned char extra;
  ssize_t tail;
  do {
    tail = read(fd, &extra, 1);
  } while (tail < 0 && errno == EINTR);
  if (tail != 0) {
    errno = tail < 0 ? errno : EINVAL;
    return -1;
  }
  return 0;
}

static int ccm_materializer_write_exact(int fd, const unsigned char *bytes,
                                        size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = write(fd, bytes + offset, length - offset);
    if (count > 0) {
      offset += (size_t)count;
    } else if (count < 0 && errno == EINTR) {
      continue;
    } else {
      errno = count == 0 ? EIO : errno;
      return -1;
    }
  }
  return 0;
}

static int ccm_materializer_verify_fd_bytes(int fd, const unsigned char *expected,
                                            size_t length) {
  if (lseek(fd, 0, SEEK_SET) < 0) {
    return -1;
  }
  unsigned char buffer[64 * 1024];
  size_t offset = 0;
  while (offset < length) {
    size_t wanted = length - offset < sizeof(buffer) ? length - offset : sizeof(buffer);
    ssize_t count = read(fd, buffer, wanted);
    if (count > 0) {
      if (memcmp(buffer, expected + offset, (size_t)count) != 0) {
        errno = EINVAL;
        return -1;
      }
      offset += (size_t)count;
    } else if (count < 0 && errno == EINTR) {
      continue;
    } else {
      errno = count == 0 ? EINVAL : errno;
      return -1;
    }
  }
  unsigned char extra;
  ssize_t tail;
  do {
    tail = read(fd, &extra, 1);
  } while (tail < 0 && errno == EINTR);
  if (tail != 0) {
    errno = tail < 0 ? errno : EINVAL;
    return -1;
  }
  return 0;
}

/* Returns 1 only for the exact valid-publisher 2 -> 1 hard-link convergence. */
static int ccm_materializer_verify_final_once(
    int directory_fd, const char *name, const unsigned char *expected,
    size_t length, const char *test_point, const char *ready_path,
    const char *barrier_path, const char *test_action) {
  struct stat path_before;
  if (fstatat(directory_fd, name, &path_before, AT_SYMLINK_NOFOLLOW) < 0) {
    return -1;
  }
  if (!S_ISREG(path_before.st_mode) || path_before.st_uid != geteuid() ||
      (path_before.st_mode & 0777) != 0500 ||
      path_before.st_size != (off_t)length) {
    errno = EINVAL;
    return -1;
  }
  int fd = openat(directory_fd, name, O_RDONLY | O_NOFOLLOW);
  if (fd < 0) {
    return -1;
  }
  struct stat opened_before;
  if (fstat(fd, &opened_before) < 0) {
    int saved = errno;
    close(fd);
    errno = saved;
    return -1;
  }
  if (!ccm_materializer_same_file_revision(&path_before, &opened_before)) {
    int converged = ccm_materializer_publish_link_converged(
        &path_before, &opened_before);
    close(fd);
    if (converged) {
      return 1;
    }
    errno = EAGAIN;
    return -1;
  }
  if (ccm_materializer_test_seam("after_final_open", test_point, ready_path,
                                 barrier_path, test_action) < 0) {
    int saved = errno;
    close(fd);
    errno = saved;
    return -1;
  }
  if (ccm_materializer_verify_fd_bytes(fd, expected, length) < 0) {
    int saved = errno;
    close(fd);
    errno = saved;
    return -1;
  }
  struct stat opened_after;
  struct stat path_after;
  if (fstat(fd, &opened_after) < 0 ||
      fstatat(directory_fd, name, &path_after, AT_SYMLINK_NOFOLLOW) < 0) {
    int saved = errno;
    close(fd);
    errno = saved;
    return -1;
  }
  int opened_stable =
      ccm_materializer_same_file_revision(&opened_before, &opened_after);
  int path_stable =
      ccm_materializer_same_file_revision(&opened_after, &path_after);
  if (!opened_stable || !path_stable) {
    int converged =
        (ccm_materializer_publish_link_converged(&opened_before,
                                                 &opened_after) &&
         path_stable) ||
        (opened_stable &&
         ccm_materializer_publish_link_converged(&opened_after, &path_after));
    close(fd);
    if (converged) {
      return 1;
    }
    errno = EAGAIN;
    return -1;
  }
  if (close(fd) < 0) {
    return -1;
  }
  return 0;
}

static int ccm_materializer_verify_final(
    int directory_fd, const char *name, const unsigned char *expected,
    size_t length, const char *test_point, const char *ready_path,
    const char *barrier_path, const char *test_action) {
  int first = ccm_materializer_verify_final_once(
      directory_fd, name, expected, length, test_point, ready_path,
      barrier_path, test_action);
  if (first <= 0) {
    return first;
  }

  /* No sleep and no errno-based retry: one exact state transition earns one
   * fresh path/open/hash/revision proof, with the test seam disabled. */
  int second = ccm_materializer_verify_final_once(
      directory_fd, name, expected, length, "-", "-", "-", "none");
  if (second == 0) {
    return 0;
  }
  if (second < 0) {
    return -1;
  }
  errno = EAGAIN;
  return -1;
}

static int ccm_materializer_flush_directory(int directory_fd) {
  if (fsync(directory_fd) == 0) {
    return 0;
  }
#if defined(__APPLE__)
  if (errno == EINVAL || errno == ENOTSUP) {
    return 0;
  }
#endif
  return -1;
}

static int ccm_materializer_self_cleanup_bootstrap(const char *instance_name) {
  pid_t publisher_pid = 0;
  if (!ccm_materializer_valid_bootstrap_candidate(instance_name,
                                                  &publisher_pid)) {
    errno = EINVAL;
    return -1;
  }
  (void)publisher_pid;

  struct stat root;
  struct stat instance;
  struct stat bootstrap;
  if (fstat(CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD, &root) < 0 ||
      fstat(CCM_MATERIALIZER_BOOTSTRAP_INSTANCE_FD, &instance) < 0 ||
      fstat(CCM_MATERIALIZER_BOOTSTRAP_FILE_FD, &bootstrap) < 0) {
    return -1;
  }
  if (!S_ISDIR(root.st_mode) || root.st_uid != geteuid() ||
      (root.st_mode & 0777) != 0700 || !S_ISDIR(instance.st_mode) ||
      instance.st_uid != geteuid() || (instance.st_mode & 0777) != 0700 ||
      !S_ISREG(bootstrap.st_mode) || bootstrap.st_uid != geteuid() ||
      (bootstrap.st_mode & 0777) != 0500) {
    errno = EINVAL;
    return -1;
  }

  struct stat instance_path;
  if (fstatat(CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD, instance_name,
              &instance_path, AT_SYMLINK_NOFOLLOW) < 0) {
    if (errno != ENOENT) {
      return -1;
    }
  } else if (!ccm_materializer_same_object_identity(&instance_path, &instance)) {
    errno = EAGAIN;
    return -1;
  }

  struct stat bootstrap_path;
  int bootstrap_present = 1;
  if (fstatat(CCM_MATERIALIZER_BOOTSTRAP_INSTANCE_FD, "materializer",
              &bootstrap_path, AT_SYMLINK_NOFOLLOW) < 0) {
    if (errno != ENOENT) {
      return -1;
    }
    bootstrap_present = 0;
  } else if (!ccm_materializer_same_file_revision(&bootstrap_path, &bootstrap)) {
    errno = EAGAIN;
    return -1;
  }

  if (bootstrap_present &&
      unlinkat(CCM_MATERIALIZER_BOOTSTRAP_INSTANCE_FD, "materializer", 0) < 0 &&
      errno != ENOENT) {
    return -1;
  }
  if (ccm_materializer_flush_directory(
          CCM_MATERIALIZER_BOOTSTRAP_INSTANCE_FD) < 0) {
    return -1;
  }

  struct stat instance_after;
  struct stat instance_path_after;
  if (fstat(CCM_MATERIALIZER_BOOTSTRAP_INSTANCE_FD, &instance_after) < 0) {
    return -1;
  }
  if (fstatat(CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD, instance_name,
              &instance_path_after, AT_SYMLINK_NOFOLLOW) < 0) {
    if (errno == ENOENT) {
      return ccm_materializer_flush_directory(
          CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD);
    }
    return -1;
  }
  if (!ccm_materializer_same_object_identity(&instance_after,
                                             &instance_path_after)) {
    errno = EAGAIN;
    return -1;
  }
  if (unlinkat(CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD, instance_name,
               AT_REMOVEDIR) < 0 &&
      errno != ENOENT) {
    return -1;
  }
  return ccm_materializer_flush_directory(
      CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD);
}

static int ccm_materializer_snapshot_bootstraps(
    int root_fd, struct ccm_materializer_candidate_list *list) {
  int duplicate = dup(root_fd);
  if (duplicate < 0) {
    return -1;
  }
  DIR *directory = fdopendir(duplicate);
  if (directory == NULL) {
    int saved = errno;
    close(duplicate);
    errno = saved;
    return -1;
  }
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(directory);
    if (entry == NULL) {
      break;
    }
    pid_t publisher_pid = 0;
    if (!ccm_materializer_valid_bootstrap_candidate(entry->d_name,
                                                    &publisher_pid)) {
      continue;
    }
    int dead = ccm_materializer_dead_process(publisher_pid);
    if (dead < 0 ||
        (dead > 0 &&
         ccm_materializer_add_candidate(list, entry->d_name) < 0)) {
      int saved = errno;
      closedir(directory);
      errno = saved;
      return -1;
    }
  }
  int saved = errno;
  if (closedir(directory) < 0 && saved == 0) {
    saved = errno;
  }
  if (saved != 0) {
    errno = saved;
    return -1;
  }
  return 0;
}

static int ccm_materializer_recover_bootstraps(
    int root_fd, const struct ccm_materializer_candidate_list *list) {
  for (size_t index = 0; index < list->count; index++) {
    const char *name = list->names[index];
    pid_t publisher_pid = 0;
    if (!ccm_materializer_valid_bootstrap_candidate(name, &publisher_pid)) {
      errno = EINVAL;
      return -1;
    }
    int dead = ccm_materializer_dead_process(publisher_pid);
    if (dead < 0) {
      return -1;
    }
    if (dead == 0) {
      continue;
    }

    struct stat path_before;
    if (fstatat(root_fd, name, &path_before, AT_SYMLINK_NOFOLLOW) < 0) {
      if (errno == ENOENT) {
        continue;
      }
      return -1;
    }
    if (!S_ISDIR(path_before.st_mode) || path_before.st_uid != geteuid() ||
        (path_before.st_mode & 0777) != 0700) {
      errno = EINVAL;
      return -1;
    }
    int instance_fd = openat(root_fd, name,
                             O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (instance_fd < 0) {
      if (errno == ENOENT) {
        continue;
      }
      return -1;
    }
    struct stat opened_before;
    if (fstat(instance_fd, &opened_before) < 0) {
      int saved = errno;
      close(instance_fd);
      errno = saved;
      return -1;
    }
    if (!ccm_materializer_same_object_identity(&path_before, &opened_before)) {
      close(instance_fd);
      errno = EAGAIN;
      return -1;
    }

    int duplicate = dup(instance_fd);
    if (duplicate < 0) {
      int saved = errno;
      close(instance_fd);
      errno = saved;
      return -1;
    }
    DIR *directory = fdopendir(duplicate);
    if (directory == NULL) {
      int saved = errno;
      close(duplicate);
      close(instance_fd);
      errno = saved;
      return -1;
    }
    int saw_bootstrap = 0;
    int scan_failure = 0;
    for (;;) {
      errno = 0;
      struct dirent *entry = readdir(directory);
      if (entry == NULL) {
        scan_failure = errno;
        break;
      }
      if (strcmp(entry->d_name, ".") == 0 ||
          strcmp(entry->d_name, "..") == 0) {
        continue;
      }
      if (strcmp(entry->d_name, "materializer") != 0 || saw_bootstrap) {
        scan_failure = EINVAL;
        break;
      }
      saw_bootstrap = 1;
    }
    if (closedir(directory) < 0 && scan_failure == 0) {
      scan_failure = errno;
    }
    if (scan_failure != 0) {
      close(instance_fd);
      errno = scan_failure;
      return -1;
    }

    if (saw_bootstrap) {
      struct stat bootstrap_path;
      if (fstatat(instance_fd, "materializer", &bootstrap_path,
                  AT_SYMLINK_NOFOLLOW) < 0) {
        if (errno != ENOENT) {
          int saved = errno;
          close(instance_fd);
          errno = saved;
          return -1;
        }
      } else {
        mode_t permissions = bootstrap_path.st_mode & 0777;
        if (!S_ISREG(bootstrap_path.st_mode) ||
            bootstrap_path.st_uid != geteuid() ||
            (permissions != 0600 && permissions != 0500)) {
          close(instance_fd);
          errno = EINVAL;
          return -1;
        }
        int bootstrap_fd = openat(instance_fd, "materializer",
                                  O_RDONLY | O_NOFOLLOW);
        if (bootstrap_fd < 0) {
          if (errno != ENOENT) {
            int saved = errno;
            close(instance_fd);
            errno = saved;
            return -1;
          }
        } else {
          struct stat opened_bootstrap;
          if (fstat(bootstrap_fd, &opened_bootstrap) < 0) {
            int saved = errno;
            close(bootstrap_fd);
            close(instance_fd);
            errno = saved;
            return -1;
          }
          if (!ccm_materializer_same_file_revision(&bootstrap_path,
                                                   &opened_bootstrap)) {
            close(bootstrap_fd);
            close(instance_fd);
            errno = EAGAIN;
            return -1;
          }
          if (close(bootstrap_fd) < 0) {
            int saved = errno;
            close(instance_fd);
            errno = saved;
            return -1;
          }
        }
        if (unlinkat(instance_fd, "materializer", 0) < 0 &&
            errno != ENOENT) {
          int saved = errno;
          close(instance_fd);
          errno = saved;
          return -1;
        }
      }
    }
    if (ccm_materializer_flush_directory(instance_fd) < 0) {
      int saved = errno;
      close(instance_fd);
      errno = saved;
      return -1;
    }
    struct stat opened_after;
    struct stat path_after;
    if (fstat(instance_fd, &opened_after) < 0) {
      int saved = errno;
      close(instance_fd);
      errno = saved;
      return -1;
    }
    if (fstatat(root_fd, name, &path_after, AT_SYMLINK_NOFOLLOW) < 0) {
      if (errno == ENOENT) {
        close(instance_fd);
        continue;
      }
      int saved = errno;
      close(instance_fd);
      errno = saved;
      return -1;
    }
    if (!ccm_materializer_same_object_identity(&opened_after, &path_after)) {
      close(instance_fd);
      errno = EAGAIN;
      return -1;
    }
    if (close(instance_fd) < 0) {
      return -1;
    }
    if (unlinkat(root_fd, name, AT_REMOVEDIR) < 0 && errno != ENOENT) {
      return -1;
    }
  }
  return ccm_materializer_flush_directory(root_fd);
}

/* Returns -1 when argv does not select materializer mode. */
static int ccm_runtime_launcher_materializer_main(int argc, char **argv) {
  if (argc < 2 || strcmp(argv[1], "--ccm-launcher-materialize-v1") != 0) {
    return -1;
  }
  if (argc != 11 || strcmp(argv[2], CCM_RUNTIME_HELPER_CONTRACT) != 0 ||
      !ccm_materializer_valid_sha256(argv[3]) ||
      !ccm_materializer_valid_uuid(argv[4])) {
    return ccm_materializer_report("argv", EINVAL);
  }
  errno = 0;
  char *length_end = NULL;
  unsigned long long parsed_length = strtoull(argv[5], &length_end, 10);
  if (errno != 0 || length_end == argv[5] || *length_end != '\0' ||
      parsed_length == 0 || parsed_length > CCM_MATERIALIZER_MAX_BYTES ||
      parsed_length > SIZE_MAX) {
    return ccm_materializer_report("length", EINVAL);
  }
  size_t length = (size_t)parsed_length;
  const char *bootstrap_instance_name = argv[6];
  const char *test_point = argv[7];
  const char *ready_path = argv[8];
  const char *barrier_path = argv[9];
  const char *test_action = argv[10];

  int control_flags = fcntl(CCM_MATERIALIZER_CONTROL_FD, F_GETFD);
  if (control_flags < 0 ||
      fcntl(CCM_MATERIALIZER_CONTROL_FD, F_SETFD,
            control_flags | FD_CLOEXEC) < 0) {
    return ccm_materializer_report("control-fd", errno);
  }
  struct stat directory;
  if (fstat(CCM_MATERIALIZER_DIRECTORY_FD, &directory) < 0) {
    return ccm_materializer_report("directory-fstat", errno);
  }
  if (!S_ISDIR(directory.st_mode) || directory.st_uid != geteuid() ||
      (directory.st_mode & 0777) != 0700) {
    return ccm_materializer_report("directory-policy", EINVAL);
  }

  for (int inherited_fd = CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD;
       inherited_fd <= CCM_MATERIALIZER_BOOTSTRAP_FILE_FD; inherited_fd++) {
    int inherited_flags = fcntl(inherited_fd, F_GETFD);
    if (inherited_flags < 0 ||
        fcntl(inherited_fd, F_SETFD, inherited_flags | FD_CLOEXEC) < 0) {
      return ccm_materializer_report("bootstrap-fd", errno);
    }
  }
  if (ccm_materializer_test_seam("before_bootstrap_self_cleanup", test_point,
                                 ready_path, barrier_path, test_action) < 0 ||
      ccm_materializer_self_cleanup_bootstrap(bootstrap_instance_name) < 0) {
    return ccm_materializer_report("bootstrap-self-clean", errno);
  }
  struct ccm_materializer_candidate_list bootstrap_candidates = {0};
  if (ccm_materializer_snapshot_bootstraps(
          CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD, &bootstrap_candidates) < 0) {
    int saved = errno;
    ccm_materializer_free_candidates(&bootstrap_candidates);
    return ccm_materializer_report("bootstrap-recovery-snapshot", saved);
  }
  if (ccm_materializer_test_seam("before_bootstrap_recovery", test_point,
                                 ready_path, barrier_path, test_action) < 0 ||
      ccm_materializer_recover_bootstraps(
          CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD, &bootstrap_candidates) < 0) {
    int saved = errno;
    ccm_materializer_free_candidates(&bootstrap_candidates);
    return ccm_materializer_report("bootstrap-recovery", saved);
  }
  ccm_materializer_free_candidates(&bootstrap_candidates);

  unsigned char *bytes = malloc(length);
  if (bytes == NULL) {
    return ccm_materializer_report("artifact-alloc", errno == 0 ? ENOMEM : errno);
  }
  if (ccm_materializer_read_exact(STDIN_FILENO, bytes, length) < 0) {
    int saved = errno;
    free(bytes);
    return ccm_materializer_report("artifact-read", saved);
  }

  char final_name[160];
  char temporary_name[224];
  int final_length = snprintf(final_name, sizeof(final_name), "%s-%s",
                              CCM_RUNTIME_HELPER_CONTRACT, argv[3]);
  int temporary_length = snprintf(temporary_name, sizeof(temporary_name),
                                  ".%s-%ld-%s.tmp",
                                  CCM_RUNTIME_HELPER_CONTRACT, (long)getpid(), argv[4]);
  if (final_length <= 0 || (size_t)final_length >= sizeof(final_name) ||
      temporary_length <= 0 || (size_t)temporary_length >= sizeof(temporary_name)) {
    free(bytes);
    return ccm_materializer_report("leaf-name", ENAMETOOLONG);
  }

  struct ccm_materializer_candidate_list candidates = {0};
  if (ccm_materializer_snapshot_candidates(CCM_MATERIALIZER_DIRECTORY_FD,
                                           &candidates) < 0) {
    int saved = errno;
    ccm_materializer_free_candidates(&candidates);
    free(bytes);
    return ccm_materializer_report("cleanup-snapshot", saved);
  }
  if (ccm_materializer_test_seam("before_temp_cleanup", test_point, ready_path,
                                 barrier_path, test_action) < 0 ||
      ccm_materializer_cleanup_candidates(CCM_MATERIALIZER_DIRECTORY_FD,
                                          &candidates) < 0) {
    int saved = errno;
    ccm_materializer_free_candidates(&candidates);
    free(bytes);
    return ccm_materializer_report("cleanup", saved);
  }
  ccm_materializer_free_candidates(&candidates);

  struct stat existing;
  if (fstatat(CCM_MATERIALIZER_DIRECTORY_FD, final_name, &existing,
              AT_SYMLINK_NOFOLLOW) == 0) {
    if (ccm_materializer_verify_final(CCM_MATERIALIZER_DIRECTORY_FD, final_name,
                                      bytes, length, test_point, ready_path,
                                      barrier_path, test_action) < 0 ||
        ccm_materializer_flush_directory(CCM_MATERIALIZER_DIRECTORY_FD) < 0) {
      int saved = errno;
      free(bytes);
      return ccm_materializer_report("existing-final", saved);
    }
    free(bytes);
    return 0;
  }
  if (errno != ENOENT) {
    int saved = errno;
    free(bytes);
    return ccm_materializer_report("final-observe", saved);
  }

  int temporary_fd = openat(CCM_MATERIALIZER_DIRECTORY_FD, temporary_name,
                            O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  if (temporary_fd < 0) {
    int saved = errno;
    free(bytes);
    return ccm_materializer_report("temp-create", saved);
  }
  int failure = 0;
  const char *failure_stage = "temp-write";
  if (fchmod(temporary_fd, 0600) < 0 ||
      ccm_materializer_write_exact(temporary_fd, bytes, length) < 0 ||
      fsync(temporary_fd) < 0) {
    failure = errno;
  } else {
    failure_stage = "temp-seal";
    if (fchmod(temporary_fd, 0500) < 0 || fsync(temporary_fd) < 0) {
      failure = errno;
    }
  }
  if (failure == 0) {
    struct stat sealed;
    failure_stage = "temp-verify";
    if (fstat(temporary_fd, &sealed) < 0) {
      failure = errno;
    } else if (!S_ISREG(sealed.st_mode) || sealed.st_uid != geteuid() ||
               (sealed.st_mode & 0777) != 0500 ||
               sealed.st_size != (off_t)length) {
      failure = EINVAL;
    } else if (ccm_materializer_verify_fd_bytes(temporary_fd, bytes, length) < 0) {
      failure = errno;
    }
  }
  if (close(temporary_fd) < 0 && failure == 0) {
    failure = errno;
    failure_stage = "temp-close";
  }
  if (failure != 0) {
    (void)unlinkat(CCM_MATERIALIZER_DIRECTORY_FD, temporary_name, 0);
    free(bytes);
    return ccm_materializer_report(failure_stage, failure);
  }

  if (ccm_materializer_test_seam("before_helper_publish", test_point, ready_path,
                                 barrier_path, test_action) < 0) {
    int saved = errno;
    (void)unlinkat(CCM_MATERIALIZER_DIRECTORY_FD, temporary_name, 0);
    free(bytes);
    return ccm_materializer_report("before-publish-seam", saved);
  }
  int published = 0;
  if (linkat(CCM_MATERIALIZER_DIRECTORY_FD, temporary_name,
             CCM_MATERIALIZER_DIRECTORY_FD, final_name, 0) == 0) {
    published = 1;
  } else if (errno != EEXIST) {
    int saved = errno;
    (void)unlinkat(CCM_MATERIALIZER_DIRECTORY_FD, temporary_name, 0);
    free(bytes);
    return ccm_materializer_report(saved == EXDEV ? "publish-cross-volume" : "publish-link",
                                   saved);
  }
  if (published &&
      ccm_materializer_test_seam("after_helper_publish", test_point, ready_path,
                                 barrier_path, test_action) < 0) {
    int saved = errno;
    (void)unlinkat(CCM_MATERIALIZER_DIRECTORY_FD, temporary_name, 0);
    free(bytes);
    return ccm_materializer_report("after-publish-seam", saved);
  }
  if (unlinkat(CCM_MATERIALIZER_DIRECTORY_FD, temporary_name, 0) < 0 &&
      errno != ENOENT) {
    int saved = errno;
    free(bytes);
    return ccm_materializer_report("temp-unlink", saved);
  }
  if (ccm_materializer_verify_final(CCM_MATERIALIZER_DIRECTORY_FD, final_name,
                                    bytes, length, test_point, ready_path,
                                    barrier_path, test_action) < 0 ||
      ccm_materializer_flush_directory(CCM_MATERIALIZER_DIRECTORY_FD) < 0) {
    int saved = errno;
    free(bytes);
    return ccm_materializer_report("final-verify", saved);
  }
  free(bytes);
  return 0;
}

#endif
