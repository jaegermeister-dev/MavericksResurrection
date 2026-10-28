/* Read-only filesystem manifest helper. Build for macOS 10.10 and bundle it;
 * end users never need a compiler. Content hashes use logical file bytes.
 * A complete final JSON record is required before a scan can be accepted.
 * Default scans include every path. Installed-system scans omit only the four
 * root-level filesystem housekeeping trees already excluded by ManifestCompare. */
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/acl.h>
#include <sys/stat.h>
#include <sys/xattr.h>
#include <fts.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>
#include <limits.h>

static void fail(const char *what, const char *path) {
    fprintf(stderr, "%s: %s (%s)\n", what, path, strerror(errno));
    exit(1);
}
static NSString *utf8(const char *value) {
    NSString *text = [NSString stringWithUTF8String:value];
    if (!text) { errno = EILSEQ; fail("Invalid UTF-8 path or metadata", value); }
    return text;
}
static NSString *hex(const unsigned char *digest) {
    char encoded[CC_SHA256_DIGEST_LENGTH * 2 + 1];
    for (unsigned i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) sprintf(encoded + i * 2, "%02x", digest[i]);
    return utf8(encoded);
}
static NSString *dataHash(NSData *data) {
    CC_SHA256_CTX ctx; CC_SHA256_Init(&ctx);
    const unsigned char *bytes = [data bytes]; NSUInteger length = [data length];
    while (length) { CC_LONG n = (CC_LONG)MIN(length, (NSUInteger)1048576); CC_SHA256_Update(&ctx, bytes, n); bytes += n; length -= n; }
    unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256_Final(digest, &ctx); return hex(digest);
}
static BOOL same(const struct stat *a, const struct stat *b) {
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_mode == b->st_mode &&
        a->st_uid == b->st_uid && a->st_gid == b->st_gid && a->st_nlink == b->st_nlink && a->st_size == b->st_size &&
        a->st_flags == b->st_flags && a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec &&
        a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec && a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec &&
        a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec;
}
static void changed(const char *what, const char *path, const struct stat *before, const struct stat *after) {
    fprintf(stderr, "Before dev=%llu ino=%llu mode=%o uid=%u gid=%u links=%llu bytes=%lld flags=%u mtime=%lld.%09ld ctime=%lld.%09ld\n",
        (unsigned long long)before->st_dev, (unsigned long long)before->st_ino, before->st_mode, before->st_uid, before->st_gid,
        (unsigned long long)before->st_nlink, (long long)before->st_size, before->st_flags,
        (long long)before->st_mtimespec.tv_sec, before->st_mtimespec.tv_nsec, (long long)before->st_ctimespec.tv_sec, before->st_ctimespec.tv_nsec);
    fprintf(stderr, "After  dev=%llu ino=%llu mode=%o uid=%u gid=%u links=%llu bytes=%lld flags=%u mtime=%lld.%09ld ctime=%lld.%09ld\n",
        (unsigned long long)after->st_dev, (unsigned long long)after->st_ino, after->st_mode, after->st_uid, after->st_gid,
        (unsigned long long)after->st_nlink, (long long)after->st_size, after->st_flags,
        (long long)after->st_mtimespec.tv_sec, after->st_mtimespec.tv_nsec, (long long)after->st_ctimespec.tv_sec, after->st_ctimespec.tv_nsec);
    errno = ESTALE; fail(what, path);
}
static NSString *fileHash(const char *path, const struct stat *expected) {
    int fd = open(path, O_RDONLY | O_NOFOLLOW); if (fd < 0) fail("Cannot open", path);
    struct stat a, b;
    if (fstat(fd, &a)) fail("Cannot inspect opened file", path);
    if (!same(&a, expected)) changed("Changed before hashing", path, expected, &a);
    CC_SHA256_CTX ctx; CC_SHA256_Init(&ctx); unsigned char buffer[1024 * 1024]; ssize_t n;
    while ((n = read(fd, buffer, sizeof(buffer))) != 0) {
        if (n < 0) { if (errno == EINTR) continue; fail("Cannot read", path); }
        CC_SHA256_Update(&ctx, buffer, (CC_LONG)n);
    }
    if (fstat(fd, &b)) fail("Cannot inspect hashed file", path);
    if (!same(&a, &b)) changed("Changed during hashing", path, &a, &b);
    if (close(fd)) fail("Cannot close", path);
    unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256_Final(digest, &ctx); return hex(digest);
}
static NSArray *attributes(const char *path) {
    ssize_t length = listxattr(path, NULL, 0, XATTR_NOFOLLOW);
    if (length < 0) fail("Cannot list extended attributes", path);
    NSMutableData *names = [NSMutableData dataWithLength:(NSUInteger)length];
    if (length && listxattr(path, [names mutableBytes], (size_t)length, XATTR_NOFOLLOW) != length) { errno = ESTALE; fail("Extended attribute names changed", path); }
    NSMutableArray *sorted = [NSMutableArray array];
    const char *bytes = [names bytes];
    for (ssize_t offset = 0; offset < length;) {
        size_t n = strnlen(bytes + offset, (size_t)(length - offset));
        if (n == 0 || n == (size_t)(length - offset)) { errno = EINVAL; fail("Invalid extended attribute name", path); }
        // Compression storage is allowed to differ after a metadata-preserving copy.
        // Logical file content and resource forks are independently hashed.
        if (strcmp(bytes + offset, "com.apple.decmpfs")) [sorted addObject:utf8(bytes + offset)];
        offset += n + 1;
    }
    [sorted sortUsingSelector:@selector(compare:)];
    NSMutableArray *result = [NSMutableArray array];
    for (NSString *name in sorted) {
        const char *key = [name UTF8String];
        ssize_t size = getxattr(path, key, NULL, 0, 0, XATTR_NOFOLLOW);
        if (size < 0) fail("Cannot measure extended attribute", path);
        NSMutableData *data = [NSMutableData dataWithLength:(NSUInteger)size];
        if (getxattr(path, key, [data mutableBytes], (size_t)size, 0, XATTR_NOFOLLOW) != size) { errno = ESTALE; fail("Cannot read extended attribute", path); }
        [result addObject:@{ @"name": name, @"bytes": @(size), @"sha256": dataHash(data) }];
    }
    return result;
}
static NSString *aclText(const char *path) {
    acl_t acl = acl_get_link_np(path, ACL_TYPE_EXTENDED);
    if (!acl) { if (errno == ENOENT) return @""; fail("Cannot read ACL", path); }
    ssize_t length = 0; char *text = acl_to_text(acl, &length);
    if (!text) fail("Cannot encode ACL", path);
    NSString *result = utf8(text); acl_free(text); acl_free(acl); return result;
}
static void emit(id value) {
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:&error];
    if (!data) { fprintf(stderr, "Cannot encode manifest JSON: %s\n", [[error description] UTF8String]); exit(1); }
    if (fwrite([data bytes], 1, [data length], stdout) != [data length] || fputc('\n', stdout) == EOF) { perror("Cannot write manifest"); exit(1); }
}
static BOOL filesystemMetadata(const FTSENT *entry) {
    if (entry->fts_level != 1) return NO;
    const char *name = entry->fts_name;
    return !strcmp(name, ".fseventsd") || !strcmp(name, ".Spotlight-V100") ||
        !strcmp(name, ".Trashes") || !strcmp(name, ".TemporaryItems");
}
static int order(const FTSENT **a, const FTSENT **b) { return strcmp((*a)->fts_name, (*b)->fts_name); }
int main(int argc, char **argv) {
    @autoreleasepool {
        BOOL installedSystem = argc == 3 && !strcmp(argv[1], "--installed-system");
        const char *input = argc == 2 ? argv[1] : installedSystem ? argv[2] : NULL;
        if (!input || input[0] != '/') { fprintf(stderr, "Usage: TreeManifest [--installed-system] /absolute/root > manifest.jsonl\n"); return 2; }
        char root[PATH_MAX]; struct stat rootStat;
        if (!realpath(input, root) || lstat(root, &rootStat)) fail("Cannot resolve scan root", input);
        if (!S_ISDIR(rootStat.st_mode) || !strcmp(root, "/")) { fprintf(stderr, "Choose a specific directory, not the running root filesystem.\n"); return 2; }
        char *roots[] = {root, NULL}; FTS *walk = fts_open(roots, FTS_PHYSICAL | FTS_XDEV | FTS_NOCHDIR, order);
        if (!walk) fail("Cannot scan", root);
        NSMutableDictionary *hardlinks = [NSMutableDictionary dictionary];
        unsigned long long count = 0, total = 0; FTSENT *entry; errno = 0;
        while ((entry = fts_read(walk))) {
            @autoreleasepool {
                // Skip before metadata reads or traversal errors: these host-managed
                // trees can be protected even from an administrator. Never skip any
                // other unreadable file, nor a same-named tree inside the OS payload.
                if (installedSystem && filesystemMetadata(entry)) {
                    if (entry->fts_info == FTS_D && fts_set(walk, entry, FTS_SKIP)) fail("Cannot skip filesystem metadata", entry->fts_path);
                    errno = 0;
                    continue;
                }
                if (entry->fts_info == FTS_DP) continue;
                if (entry->fts_info == FTS_ERR || entry->fts_info == FTS_DNR || entry->fts_info == FTS_NS || entry->fts_info == FTS_DC) { errno = entry->fts_errno; fail("Cannot scan entry", entry->fts_path); }
                const struct stat *st = entry->fts_statp;
                if (st->st_dev != rootStat.st_dev) { errno = EXDEV; fail("Unexpected nested filesystem", entry->fts_path); }
                const char *relative = entry->fts_level ? entry->fts_path + strlen(root) + 1 : "";
                NSString *kind = S_ISREG(st->st_mode) ? @"file" : S_ISDIR(st->st_mode) ? @"directory" : S_ISLNK(st->st_mode) ? @"symlink" : nil;
                if (!kind) { errno = EINVAL; fail("Unsupported filesystem object", entry->fts_path); }
                NSMutableDictionary *row = [@{ @"type": @"entry", @"path": utf8(relative), @"kind": kind,
                    @"mode": @(st->st_mode & 07777), @"uid": @(st->st_uid), @"gid": @(st->st_gid),
                    @"flags": @(st->st_flags & ~UF_COMPRESSED), @"mtimeSeconds": @(st->st_mtimespec.tv_sec),
                    @"mtimeNanoseconds": @(st->st_mtimespec.tv_nsec), @"acl": aclText(entry->fts_path),
                    @"xattrs": attributes(entry->fts_path) } mutableCopy];
                if (S_ISREG(st->st_mode)) {
                    row[@"bytes"] = @(st->st_size); row[@"sha256"] = fileHash(entry->fts_path, st); total += st->st_size;
                    if (st->st_nlink > 1) {
                        NSString *key = [NSString stringWithFormat:@"%llu:%llu", (unsigned long long)st->st_dev, (unsigned long long)st->st_ino];
                        if (!hardlinks[key]) hardlinks[key] = row[@"path"];
                        row[@"hardlinkTo"] = hardlinks[key];
                    }
                } else if (S_ISLNK(st->st_mode)) {
                    char link[PATH_MAX]; ssize_t n = readlink(entry->fts_path, link, sizeof(link) - 1);
                    if (n < 0 || n == sizeof(link) - 1) { errno = EINVAL; fail("Cannot read symbolic link", entry->fts_path); }
                    link[n] = 0; row[@"link"] = utf8(link);
                }
                struct stat after;
                if (lstat(entry->fts_path, &after)) fail("Cannot inspect scanned entry", entry->fts_path);
                if (!same(st, &after)) changed("Changed during scan", entry->fts_path, st, &after);
                emit(row); [row release]; count++;
            }
            errno = 0;
        }
        if (errno) fail("Cannot finish scan", root);
        if (fts_close(walk)) fail("Cannot close scan", root);
        NSMutableDictionary *complete = [@{ @"type": @"complete", @"schema": @1, @"entries": @(count), @"logicalFileBytes": @(total) } mutableCopy];
        if (installedSystem) complete[@"excludedFilesystemMetadata"] = @[@".fseventsd", @".Spotlight-V100", @".Trashes", @".TemporaryItems"];
        emit(complete); [complete release];
        if (fflush(stdout)) { perror("Cannot flush manifest"); return 1; }
    }
    return 0;
}
