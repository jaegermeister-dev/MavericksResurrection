/* No setuid installation. Called by the app's root stage worker only, after
 * process-local image ownership and hashes have been checked. Supports three
 * fixed tools/argument sets. Boot-cache generation deliberately uses another path.
 */
#include <sys/stat.h>
#include <sys/mount.h>
#include <mach/mach.h>
#include <servers/bootstrap.h>
#include <sandbox.h>
#include <unistd.h>
#include <fcntl.h>
#include <limits.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>

static void stop(const char *s) { fprintf(stderr, "MavericksResurrection runtime: %s (%d)\n", s, errno); exit(70); }
static unsigned long long number(const char *s) {
    char *end = NULL;
    if (!s || !*s || strspn(s, "0123456789") != strlen(s)) stop("Invalid identity");
    errno = 0; unsigned long long value = strtoull(s, &end, 10);
    if (errno || !end || *end) stop("Invalid identity");
    return value;
}
static void canonical(const char *path) {
    char resolved[PATH_MAX];
    if (!realpath(path, resolved) || strcmp(resolved, path)) stop("Expected a canonical path");
    for (const unsigned char *p = (const unsigned char *)path; *p; p++) if (*p < 32 || *p == 127) stop("Control character in path");
}
static void protected_file(const char *path) {
    struct stat s; canonical(path);
    if (lstat(path, &s) || !S_ISREG(s.st_mode) || s.st_uid != 0 || s.st_nlink != 1 || (s.st_mode & 0022)) stop("Unprotected runtime file");
}
static void quote_path(const char *s, char *out, size_t capacity) {
    size_t n = 0;
    while (*s) { if (n + 3 >= capacity) stop("Path too long"); if (*s == '"' || *s == '\\') out[n++] = '\\'; out[n++] = *s++; }
    out[n] = 0;
}
int main(int argc, char **argv) {
    if (geteuid() || argc != 7) return 64;
    const char *root = argv[1], *library = argv[4], *program = argv[5], *operation = argv[6];
    if (strcmp(operation, "system-caches") && strcmp(operation, "makewhatis") && strcmp(operation, "dyld-caches")) return 64;
    canonical(root); protected_file(library); protected_file(program);
    char parent[PATH_MAX], libraryParent[PATH_MAX];
    if (strlcpy(parent, program, sizeof(parent)) >= sizeof(parent) || strlcpy(libraryParent, library, sizeof(libraryParent)) >= sizeof(libraryParent)) stop("Path too long");
    char *last = strrchr(parent, '/'), *libLast = strrchr(libraryParent, '/');
    if (!last || !libLast) stop("Missing private runtime directory");
    *last = 0; *libLast = 0;
    struct stat directory;
    if (strcmp(parent, libraryParent) || lstat(parent, &directory) || !S_ISDIR(directory.st_mode) || directory.st_uid || (directory.st_mode & 0777) != 0700) stop("Runtime copies must share a private root directory");
    struct stat s; struct statfs fs;
    if (stat(root, &s) || statfs(root, &fs) || !S_ISDIR(s.st_mode) || !strcmp(root, "/") || strcmp(fs.f_mntonname, root) || strcmp(fs.f_fstypename, "hfs") || (fs.f_flags & MNT_RDONLY) ||
        (unsigned long long)s.st_dev != number(argv[2]) || (unsigned long long)s.st_ino != number(argv[3])) stop("Private mounted image changed");
    char escaped[PATH_MAX * 2 + 1], profile[PATH_MAX * 2 + 300], canary[PATH_MAX];
    quote_path(root, escaped, sizeof(escaped));
    if (snprintf(profile, sizeof(profile), "(version 1)(allow default)(deny file-write*)(allow file-write* (subpath \"%s\"))(allow file-write-data (literal \"/dev/null\"))(deny network*)(deny mach-lookup)", escaped) >= (int)sizeof(profile)) stop("Sandbox profile too long");
    if (snprintf(canary, sizeof(canary), "%s/sandbox-denied-write", parent) >= (int)sizeof(canary)) stop("Canary path too long");
    char *error = NULL;
    if (sandbox_init(profile, 0, &error)) { fprintf(stderr, "Cannot confine runtime: %s\n", error ? error : "unknown"); return 70; }
    int fd = open(canary, O_CREAT | O_EXCL | O_WRONLY, 0600);
    if (fd >= 0 || (errno != EPERM && errno != EACCES)) { if (fd >= 0) close(fd); stop("Host write boundary failed"); }
    fprintf(stderr, "GM_HOST_WRITES_DENIED\n");
    if (task_set_bootstrap_port(mach_task_self(), MACH_PORT_NULL) != KERN_SUCCESS) stop("Cannot drop service port");
    bootstrap_port = MACH_PORT_NULL;
    // Construct a fresh environment; no caller DYLD or shell startup variables.
    char envRoot[PATH_MAX + 32], envDevice[64], envInode[64], envLibrary[PATH_MAX + 32];
    snprintf(envRoot, sizeof(envRoot), "GM_PRIVATE_ROOT=%s", root);
    snprintf(envDevice, sizeof(envDevice), "GM_IMAGE_DEVICE=%llu", number(argv[2]));
    snprintf(envInode, sizeof(envInode), "GM_IMAGE_INODE=%llu", number(argv[3]));
    snprintf(envLibrary, sizeof(envLibrary), "DYLD_INSERT_LIBRARIES=%s", library);
    char *environment[] = {"PATH=/usr/bin:/bin:/usr/sbin:/sbin", "HOME=/var/root", "LANG=C", "LC_ALL=C", "_com_apple_kextd_skiplocks=1", envRoot, envDevice, envInode, envLibrary, NULL};
    char *cache[] = {(char *)program, "-system-caches", "-arch", "x86_64", "-verbose", "3", NULL};
    char *whatis[] = {(char *)program, NULL};
    /* The constructor already chroots. No -root /: Mavericks would strip the
     * leading slash from symlink alias names in its shared-cache records. */
    char *dyld[] = {(char *)program, "-force", "-arch", "i386", "-arch", "x86_64", NULL};
    alarm(!strcmp(operation, "dyld-caches") ? 1800 : 300);
    execve(program, !strcmp(operation, "system-caches") ? cache : !strcmp(operation, "dyld-caches") ? dyld : whatis, environment);
    stop("Cannot execute private tool");
}
