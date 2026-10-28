/* Loaded only by ImageRuntimeLaunch into a verified private executable copy.
 * Host libraries initialize first; the original tool's main runs inside HFS.
 */
#include <sys/stat.h>
#include <sys/mount.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <mach/mach.h>
#include <servers/bootstrap.h>

static void stop(const char *message) { dprintf(2, "MavericksResurrection runtime: %s (%d)\n", message, errno); _exit(72); }
static unsigned long long number(const char *key) {
    const char *s = getenv(key); char *end = NULL;
    if (!s || !*s || strspn(s, "0123456789") != strlen(s)) stop("Missing or invalid identity");
    errno = 0; unsigned long long n = strtoull(s, &end, 10);
    if (errno || !end || *end) stop("Invalid identity");
    return n;
}
__attribute__((constructor)) static void enter_private_image(void) {
    const char *root = getenv("GM_PRIVATE_ROOT"); struct stat s; struct statfs fs;
    if (geteuid() || !root || root[0] != '/' || !strcmp(root, "/")) stop("Expected a private root worker");
    int fd = open(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (fd < 0 || fstat(fd, &s) || fstatfs(fd, &fs)) stop("Cannot inspect image root");
    if ((unsigned long long)s.st_dev != number("GM_IMAGE_DEVICE") || (unsigned long long)s.st_ino != number("GM_IMAGE_INODE") ||
        strcmp(fs.f_mntonname, root) || strcmp(fs.f_fstypename, "hfs")) stop("Private image identity changed");
    mach_port_t port = MACH_PORT_NULL;
    if (task_get_bootstrap_port(mach_task_self(), &port) != KERN_SUCCESS || port != MACH_PORT_NULL || bootstrap_port != MACH_PORT_NULL) stop("Host service port is available");
    if (fchdir(fd) || chroot(".") || chdir("/")) stop("Cannot enter private filesystem");
    close(fd);
    unsetenv("DYLD_INSERT_LIBRARIES"); unsetenv("GM_PRIVATE_ROOT");
    unsetenv("GM_IMAGE_DEVICE"); unsetenv("GM_IMAGE_INODE");
    dprintf(2, "GM_HOST_RUNTIME_ROOTED\n");
}

#include "ImageRuntimeSpindumpCompatibility.h"
