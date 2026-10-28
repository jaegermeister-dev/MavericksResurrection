/* The Mavericks cache builder treats libspindump as optional, but does
 * not check its dynamically looked-up entry point. An incompatible host copy
 * must take the same path as an unavailable optional library. All cache
 * generation remains in the original Mavericks executable. */
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
static void *mr_runtime_dlopen(const char *path, int mode) {
    void *handle = dlopen(path, mode);
    if (handle && path && !strcmp(path, "/usr/lib/libspindump.dylib") &&
        !dlsym(handle, "dscsym_save_nuggets_for_current_caches")) {
        dlclose(handle);
        dprintf(2, "MR_OPTIONAL_SPINDUMP_UNAVAILABLE\n");
        return NULL;
    }
    return handle;
}
__attribute__((used)) static const struct {
    const void *replacement;
    const void *original;
} mr_runtime_dlopen_interpose __attribute__((section("__DATA,__interpose"))) = {
    (const void *)(unsigned long)&mr_runtime_dlopen,
    (const void *)(unsigned long)&dlopen
};
