/* Automatic stock housekeeping on native Mavericks. No driver changes, cache
 * patching, formatting, partitioning or arbitrary commands. Built for 10.9.
 * Tests compile this file into a separate harness; no runtime test switch exists.
 */
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <sys/file.h>
#include <mach/mach_time.h>
#include <poll.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <math.h>

static NSString *const GMFolder = @"/Library/Application Support/MavericksResurrection/FirstBoot";
static NSString *const GMDaemon = @"/Library/LaunchDaemons/local.mavericksresurrection.firstboot.plist";
static NSString *const GMAgent = @"/Library/LaunchAgents/local.mavericksresurrection.firstboot-notice.plist";

static NSArray *stockSteps(void) {
    return @[
      @{ @"id": @"system-keychain", @"label": @"the stock system keychain", @"path": @"/usr/bin/security", @"arguments": @[@"show-keychain-info", @"/Library/Keychains/System.keychain"], @"timeout": @120,
         @"sha256": @"da9704d070102415e06de8b48bd984ebe7ff6bb2dd34e06a1ab7239264ec215e" },
      @{ @"id": @"postfix", @"label": @"mail-system permissions", @"path": @"/usr/sbin/postfix", @"arguments": @[@"set-permissions"], @"timeout": @300,
         @"sha256": @"8c7a1f4483199528417e7539fc84749ce18fa7c0fac6ed1efa11f9c06d9b0abd" },
      @{ @"id": @"emacs", @"label": @"Emacs initialization", @"path": @"/usr/libexec/dumpemacs", @"arguments": @[@"-v"], @"timeout": @900,
         @"sha256": @"807ec1f5107ebf50a0bc03cbe9fa52b4bfe653ed591edf5c32800ce9c4927a03" },
      @{ @"id": @"automator", @"label": @"Automator's action index", @"path": @"/System/Library/Frameworks/Automator.framework/Versions/A/Support/update_automator_cache", @"arguments": @[@"--system", @"--force"], @"timeout": @600,
         @"sha256": @"53c629c44d8cba920bba2ee01ae203459703c6a0bf37385af6dac41d86a05d5b" },
      @{ @"id": @"input-sources", @"label": @"input-source caches", @"path": @"/usr/libexec/ifcstart", @"arguments": @[], @"timeout": @120,
         @"sha256": @"eaed4d35cd37a960c52f111746ac4acc5b6a32b5fd42927f1a84d783af0fda8a" },
      @{ @"id": @"xpc-cache", @"label": @"XPC service cache", @"path": @"/usr/libexec/xpchelper", @"arguments": @[@"--rebuild-cache"], @"timeout": @300,
         @"sha256": @"17695782b70b4f39f25db877d2af280979f3e58d734be1dfb84d9da8cac63b53" }
    ];
}
static void fail(NSString *message) { @throw [NSException exceptionWithName:@"MavericksResurrectionFirstBoot" reason:message userInfo:nil]; }
static double monotonic(void) { mach_timebase_info_data_t t; mach_timebase_info(&t); return (double)mach_absolute_time() * t.numer / t.denom / 1e9; }
static NSString *stamp(void) {
    NSDateFormatter *f = [[[NSDateFormatter alloc] init] autorelease];
    f.locale = [[[NSLocale alloc] initWithLocaleIdentifier:@"en_US_POSIX"] autorelease];
    f.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0]; f.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss'Z'";
    return [f stringFromDate:[NSDate date]];
}
static void protectedPath(NSString *path, BOOL directory) {
    NSString *canonical = [[path stringByStandardizingPath] stringByResolvingSymlinksInPath];
    struct stat s;
    if (![canonical isEqualToString:path] || lstat([path fileSystemRepresentation], &s) || s.st_uid || (s.st_mode & 0022) ||
        (directory ? !S_ISDIR(s.st_mode) : (!S_ISREG(s.st_mode) || s.st_nlink != 1))) fail(@"A setup path is missing, linked or not protected.");
}
static NSString *fileHash(NSString *path) {
    int fd = open([path fileSystemRepresentation], O_RDONLY | O_NOFOLLOW);
    if (fd < 0) fail(@"Cannot read a setup program.");
    CC_SHA256_CTX ctx; CC_SHA256_Init(&ctx); unsigned char b[65536], digest[CC_SHA256_DIGEST_LENGTH]; ssize_t n;
    while ((n = read(fd, b, sizeof(b))) > 0) CC_SHA256_Update(&ctx, b, (CC_LONG)n);
    close(fd); if (n < 0) fail(@"Cannot finish reading a setup program.");
    CC_SHA256_Final(digest, &ctx); char hex[65];
    for (unsigned i = 0; i < sizeof(digest); i++) sprintf(hex + i * 2, "%02x", digest[i]);
    return [NSString stringWithUTF8String:hex];
}
static NSMutableDictionary *readState(NSString *folder) {
    protectedPath(folder, YES); NSString *path = [folder stringByAppendingPathComponent:@"State.json"]; protectedPath(path, NO);
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (!data || data.length > 65536) fail(@"Setup state is unavailable or oversized.");
    id state = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:NULL];
    if (![state isKindOfClass:[NSMutableDictionary class]] || ![state[@"schema"] isEqual:@1] ||
        ![state[@"version"] isEqual:@"10.9.5"] || ![state[@"build"] isEqual:@"13F34"] ||
        ![state[@"installID"] isKindOfClass:[NSString class]] || ![[[NSUUID alloc] initWithUUIDString:state[@"installID"]] autorelease] ||
        ![state[@"steps"] isKindOfClass:[NSArray class]] || ![state[@"diagnosticsRequested"] isKindOfClass:[NSNumber class]] ||
        ![@[@"pending", @"running", @"failed", @"complete"] containsObject:state[@"phase"]]) fail(@"Setup state is invalid.");
    return state;
}
static void saveState(NSString *folder, NSMutableDictionary *state) {
    protectedPath(folder, YES); state[@"updatedUTC"] = stamp();
    NSData *data = [NSJSONSerialization dataWithJSONObject:state options:NSJSONWritingPrettyPrinted error:NULL];
    NSString *path = [folder stringByAppendingPathComponent:@"State.json"];
    if (!data || ![data writeToFile:path options:NSDataWritingAtomic error:NULL] || chmod([path fileSystemRepresentation], 0644)) fail(@"Cannot save setup progress.");
    int fd = open([path fileSystemRepresentation], O_RDONLY | O_NOFOLLOW); if (fd < 0 || fsync(fd)) { if (fd >= 0) close(fd); fail(@"Cannot synchronize setup progress."); } close(fd);
}
static void logBytes(int *fd, const void *bytes, size_t length, NSMutableDictionary *state) {
    if (*fd < 0) return;
    const char *p = bytes;
    while (length) {
        ssize_t n = write(*fd, p, length);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { close(*fd); *fd = -1; state[@"diagnosticWriteFailed"] = @YES; return; }
        p += n; length -= (size_t)n;
    }
}
static void logEvent(int *fd, NSString *message, NSMutableDictionary *state) {
    NSData *data = [[NSString stringWithFormat:@"[%@] %@\n", stamp(), message] dataUsingEncoding:NSUTF8StringEncoding];
    logBytes(fd, data.bytes, data.length, state);
}
static int openLog(NSString *folder, NSMutableDictionary *state) {
    if (![state[@"diagnosticsRequested"] boolValue]) return -1;
    NSString *path = [folder stringByAppendingPathComponent:@"Diagnostics.log"];
    int fd = open([path fileSystemRepresentation], O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW, 0600);
    struct stat s;
    if (fd < 0 || fstat(fd, &s) || !S_ISREG(s.st_mode) || s.st_uid || s.st_nlink != 1 || (s.st_mode & 0077)) {
        if (fd >= 0) close(fd); state[@"diagnosticWriteFailed"] = @YES; return -1;
    }
    fcntl(fd, F_SETFD, FD_CLOEXEC); return fd;
}
static NSDictionary *executeStep(NSDictionary *step, int *logFD, NSMutableDictionary *state) {
    NSString *program = step[@"path"]; NSArray *arguments = step[@"arguments"];
    protectedPath(program, NO);
    if (![fileHash(program) isEqualToString:step[@"sha256"]]) fail(@"An original Mavericks setup program has changed.");
    NSUInteger argc = arguments.count + 1; char **args = calloc(argc + 1, sizeof(char *));
    if (!args) fail(@"Cannot allocate setup arguments.");
    args[0] = strdup([program fileSystemRepresentation]);
    for (NSUInteger i = 0; i < arguments.count; i++) args[i + 1] = strdup([arguments[i] UTF8String]);
    int pipes[2]; if (pipe(pipes)) fail(@"Cannot capture setup output.");
    BOOL publicCache = [step[@"id"] isEqualToString:@"automator"] || [step[@"id"] isEqualToString:@"xpc-cache"];
    double started = monotonic(); pid_t pid = fork();
    if (pid == 0) {
        setpgid(0, 0); close(pipes[0]); int nullFD = open("/dev/null", O_RDONLY);
        if (nullFD < 0 || dup2(nullFD, STDIN_FILENO) < 0 || dup2(pipes[1], STDOUT_FILENO) < 0 || dup2(pipes[1], STDERR_FILENO) < 0) _exit(126);
        if (nullFD > 2) close(nullFD); if (pipes[1] > 2) close(pipes[1]);
        char *environment[] = {"PATH=/usr/bin:/bin:/usr/sbin:/sbin", "HOME=/var/root", "LANG=C", "LC_ALL=C", NULL};
        // These stock caches are public-readable; retain the parent mask for private state.
        if (publicCache) umask(022);
        chdir("/"); execve(args[0], args, environment); _exit(127);
    }
    close(pipes[1]);
    for (NSUInteger i = 0; i < argc; i++) free(args[i]); free(args);
    if (pid < 0) { close(pipes[0]); fail(@"Cannot start a setup program."); }
    setpgid(pid, pid); fcntl(pipes[0], F_SETFL, O_NONBLOCK);
    BOOL done = NO, eof = NO, timedOut = NO; int status = 0; unsigned long long bytes = 0;
    double deadline = started + [step[@"timeout"] doubleValue], killedAt = 0;
    while (!done || !eof) {
        struct pollfd p = {pipes[0], POLLIN | POLLHUP, 0}; poll(&p, 1, 100);
        char buffer[16384]; ssize_t n;
        while ((n = read(pipes[0], buffer, sizeof(buffer))) > 0) { bytes += n; logBytes(logFD, buffer, (size_t)n, state); }
        if (n == 0 || (n < 0 && errno != EAGAIN && errno != EINTR)) eof = YES;
        if (!done) { pid_t result = waitpid(pid, &status, WNOHANG); if (result == pid) done = YES; else if (result < 0 && errno != EINTR) { done = YES; status = 127 << 8; } }
        double now = monotonic();
        if ((!done || !eof) && !timedOut && now >= deadline) { timedOut = YES; killedAt = now; kill(-pid, SIGTERM); }
        if (timedOut && now >= killedAt + 2) { kill(-pid, SIGKILL); if (!done) { while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {} done = YES; } eof = YES; }
    }
    close(pipes[0]); int code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + (WIFSIGNALED(status) ? WTERMSIG(status) : 0);
    return @{ @"exitCode": @(code), @"timedOut": @(timedOut), @"outputBytes": @(bytes), @"seconds": @(monotonic() - started) };
}
static BOOL runSteps(NSString *folder, NSMutableDictionary *state, NSArray *steps) {
    if ([state[@"steps"] count] != steps.count) fail(@"Setup step inventory differs.");
    for (NSUInteger i = 0; i < steps.count; i++) {
        id row = state[@"steps"][i];
        if (![row isKindOfClass:[NSMutableDictionary class]] || ![row[@"id"] isEqual:steps[i][@"id"]] ||
            ![@[@"pending", @"running", @"failed", @"complete"] containsObject:row[@"status"]]) fail(@"Setup step state differs.");
    }
    int logFD = openLog(folder, state); BOOL success = YES;
    @try {
        state[@"phase"] = @"running"; saveState(folder, state); logEvent(&logFD, @"Native Mavericks housekeeping started", state);
        for (NSUInteger i = 0; i < steps.count; i++) {
            NSMutableDictionary *row = state[@"steps"][i]; NSDictionary *step = steps[i];
            if ([row[@"status"] isEqual:@"complete"]) continue;
            row[@"status"] = @"running"; row[@"attempts"] = @([row[@"attempts"] integerValue] + 1); row[@"startedUTC"] = stamp();
            state[@"activeStep"] = step[@"label"]; [state removeObjectForKey:@"failure"]; saveState(folder, state);
            logEvent(&logFD, [NSString stringWithFormat:@"Starting %@ %@", step[@"path"], [step[@"arguments"] componentsJoinedByString:@" "]], state);
            @try {
                NSDictionary *result = executeStep(step, &logFD, state); row[@"result"] = result;
                if ([result[@"exitCode"] intValue] || [result[@"timedOut"] boolValue]) fail(@"A setup utility failed or timed out.");
                row[@"status"] = @"complete"; row[@"finishedUTC"] = stamp(); saveState(folder, state);
                logEvent(&logFD, [NSString stringWithFormat:@"Completed %@", step[@"id"]], state);
            } @catch (NSException *e) {
                row[@"status"] = @"failed"; state[@"phase"] = @"failed"; state[@"failure"] = e.reason; success = NO;
                saveState(folder, state); logEvent(&logFD, e.reason, state); break;
            }
        }
        if (success) { state[@"phase"] = @"complete"; state[@"completedUTC"] = stamp(); [state removeObjectForKey:@"activeStep"]; saveState(folder, state); logEvent(&logFD, @"Mavericks housekeeping completed", state); }
    } @finally { if (logFD >= 0) { if (fsync(logFD)) state[@"diagnosticWriteFailed"] = @YES; close(logFD); } }
    saveState(folder, state); return success;
}
static BOOL nativeMavericks(void) {
    NSDictionary *os = [NSDictionary dictionaryWithContentsOfFile:@"/System/Library/CoreServices/SystemVersion.plist"];
    return [os[@"ProductVersion"] isEqual:@"10.9.5"] && [os[@"ProductBuildVersion"] isEqual:@"13F34"];
}
static void retireJob(NSString *path) {
    struct stat s;
    if (lstat([path fileSystemRepresentation], &s)) { if (errno == ENOENT) return; fail(@"Cannot inspect a completed startup job."); }
    protectedPath(path, NO); if (unlink([path fileSystemRepresentation])) fail(@"Cannot retire a completed startup job.");
}
static NSDictionary *waitForSetupNotice(NSString *folder, double timeout) {
    double deadline = monotonic() + timeout;
    while (YES) {
        @try {
            NSMutableDictionary *state = readState(folder);
            BOOL allComplete = [state[@"steps"] count] > 0;
            NSMutableSet *seen = [NSMutableSet set];
            for (id row in state[@"steps"]) {
                if (![row isKindOfClass:[NSDictionary class]] || ![row[@"id"] isKindOfClass:[NSString class]] ||
                    ![row[@"id"] length] || [seen containsObject:row[@"id"]] ||
                    ![@[@"pending",@"running",@"failed",@"complete"] containsObject:row[@"status"]]) fail(@"Setup step status is invalid.");
                [seen addObject:row[@"id"]]; if (![row[@"status"] isEqual:@"complete"]) allComplete = NO;
            }
            if (![seen count]) fail(@"Setup step status is missing.");
            if ([state[@"phase"] isEqual:@"complete"]) {
                if (!allComplete) fail(@"Setup completion status is inconsistent.");
                return @{@"code":@0,@"kind":@"complete"};
            }
            if ([state[@"phase"] isEqual:@"failed"]) {
                NSString *label = @"initial housekeeping";
                for (NSDictionary *step in stockSteps()) if ([step[@"id"] isEqual:state[@"activeStep"]]) label = step[@"label"];
                return @{@"code":@1,@"kind":@"failed",@"message":[NSString stringWithFormat:@"MavericksResurrection could not finish %@. Keep this Mavericks installation and return to your working macOS installation for troubleshooting. Unfinished housekeeping will retry after a reboot.",label]};
            }
        } @catch (NSException *error) {
            return @{@"code":@78,@"kind":@"unavailable",@"message":@"MavericksResurrection could not read or verify its initial setup status. Completion could not be confirmed. Keep this Mavericks installation and return to your working macOS installation for troubleshooting."};
        }
        if (monotonic() >= deadline) return @{@"code":@75,@"kind":@"timeout",@"message":@"Initial Mavericks setup has not reported completion yet. Some work may still be running. Keep this installation and allow more time. You can return to your working macOS installation for troubleshooting."};
        usleep((useconds_t)(fmin(2.0, fmax(0.0, deadline - monotonic())) * 1000000));
    }
}
static int presentSetupNotice(NSDictionary *notice) {
    if (![notice[@"code"] intValue]) return 0;
    [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory]; [NSApp activateIgnoringOtherApps:YES];
    NSAlert *alert = [[[NSAlert alloc] init] autorelease]; alert.messageText = @"Mavericks setup needs attention";
    alert.informativeText = notice[@"message"]; [alert addButtonWithTitle:@"OK"]; [alert runModal];
    return [notice[@"code"] intValue];
}
#ifndef GM_FIRSTBOOT_TEST
int main(int argc, char **argv) {
    @autoreleasepool {
        @try {
            if (argc > 2 || (argc == 2 && strcmp(argv[1], "--notify"))) return 64;
            if (!nativeMavericks()) { fprintf(stderr, "This helper only runs on the newly installed Mavericks 10.9.5 (13F34).\n"); return 78; }
            if (argc == 2) {
                if (!geteuid()) return 64;
                return presentSetupNotice(waitForSetupNotice(GMFolder, 2100));
            }
            if (geteuid()) return 77;
            umask(077); protectedPath(GMFolder, YES);
            NSString *lockPath = [GMFolder stringByAppendingPathComponent:@"Run.lock"];
            int lock = open([lockPath fileSystemRepresentation], O_RDWR | O_CREAT | O_NOFOLLOW, 0600);
            if (lock < 0 || flock(lock, LOCK_EX | LOCK_NB)) return 75;
            fcntl(lock, F_SETFD, FD_CLOEXEC);
            NSMutableDictionary *state = readState(GMFolder);
            BOOL ok = [state[@"phase"] isEqual:@"complete"] || runSteps(GMFolder, state, stockSteps());
            if (ok) { retireJob(GMDaemon); retireJob(GMAgent); }
            close(lock); return ok ? 0 : 1;
        } @catch (NSException *e) { fprintf(stderr, "%s\n", [e.reason UTF8String]); return 1; }
    }
}
#endif
