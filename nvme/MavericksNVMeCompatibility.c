/* Private research prototype for the High Sierra x86_64 NVMe driver on Darwin 13.
 * This is an ABI bridge, not a storage driver. The original NVMe implementation
 * still performs command submission, data transfer, completion, and cache flush.
 * No hardware validation has been performed. Do not load on the development OS.
 */
#ifdef GM_COMPAT_TEST
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#else
#include <mach/kmod.h>
#include <libkern/libkern.h>
#include <stdbool.h>
#endif

#define GM_UNSUPPORTED ((int)0xe00002c7)
#define GM_BAD_ARGUMENT ((int)0xe00002c2)

extern void panic(const char *, ...) __attribute__((noreturn));
extern const void *gm_symbol_create(const char *)
    __asm__("__ZN8OSSymbol17withCStringNoCopyEPKc");
extern void gm_object_release(const void *) __asm__("__ZNK8OSObject7releaseEv");
extern bool gm_old_timer_init(void *, void *, void (*)(void *, void *))
    __asm__("__ZN18IOTimerEventSource4initEP8OSObjectPFvS1_PS_E");
extern int gm_old_timer_timeout(void *, uint64_t)
    __asm__("__ZN18IOTimerEventSource10setTimeoutEy");
extern int gm_old_timer_wake(void *, uint64_t)
    __asm__("__ZN18IOTimerEventSource10wakeAtTimeEy");

/* Mavericks safeMetaCast(object, NULL) returns NULL. The audit of the Darwin 13
 * binary confirms it traverses the class chain without dereferencing this NULL.
 * The High Sierra AMFI entitlement path therefore denies the optional request.
 */
const void *gm_nvme_unavailable_amfi_metaclass = NULL;
void *gm_nvme_unavailable_entitlements(void *service, void *proc) {
    (void)service; (void)proc;
    return NULL;
}

/* Mavericks does not publish the later panic action symbol. Interning its exact
 * name preserves the driver's comparison without substituting another event.
 * Ordinary shutdown, power management, and flush paths remain in the driver.
 */
const void *gm_nvme_panic_action_key = NULL;

/* The stock x86_64 Mavericks kernel has CONFIG_PROTECT disabled (its bufattr
 * flags begin at offset 0 and bufattr_cpoff returns 0). It supplies no cpx object.
 * Generic IONVMeController::IsEncryptionSupported also returns false in donor.
 */
void *gm_nvme_no_cpx(void *attributes) { (void)attributes; return NULL; }
const void *gm_nvme_no_cpx_key(void *cpx) { (void)cpx; return NULL; }
uint16_t gm_nvme_no_cpx_key_length(void *cpx) { (void)cpx; return 0; }
bool gm_nvme_no_sep_key(void *cpx) { (void)cpx; return false; }
int gm_nvme_bufattr_passive(const void *attributes) {
    return attributes ? ((*(const uint64_t *)attributes & 0x80U) != 0) : 0;
}
/* These two routines exist in the Mavericks kernel but are not exported through
 * its KPI bundles. Match the inspected x86_64 bodies and CONFIG_PROTECT=0 layout. */
uint64_t gm_nvme_bufattr_cpoff(const void *attributes) { (void)attributes;return 0; }
int gm_nvme_bufattr_quickcomplete(const void *attributes) {
    return attributes ? ((*(const uint64_t *)attributes & 0x40U) != 0) : 0;
}

/* Preserve checked-string semantics; never replace this with unbounded strcat. */
char *gm_nvme_strncat_checked(char *dst, const char *src, size_t n, size_t cap) {
    size_t used=0, added=0;
    while (used<cap && dst[used]) ++used;
    if (used==cap) panic("MavericksNVMe: unterminated debug buffer");
    while (added<n && src[added]) {
        if (added>=cap-used-1) panic("MavericksNVMe: debug buffer overflow");
        ++added;
    }
    for (size_t i=0;i<added;++i) dst[used+i]=src[i];
    dst[used+added]=0;
    return dst;
}

/* High Sierra implements doSynchronize(block,count,options); Mavericks calls
 * the older doSynchronizeCache slot. Slot 290 is the donor's real doSynchronize
 * method. Zero options requests a full device flush, not a barrier-only request.
 * Return the genuine completion/error status, never unconditional success.
 */
int gm_nvme_flush(void *device) {
    typedef int (*sync_fn)(void *,uint64_t,uint64_t,uint32_t);
    if (!device) return GM_BAD_ARGUMENT;
    sync_fn fn=(sync_fn)(*(void ***)device)[290];
    if (!fn) return GM_BAD_ARGUMENT;
    return fn(device,0,0,0);
}

int gm_nvme_provision_status(void *device,uint64_t block,uint64_t count,
    uint32_t *extentCount,void *extents,uint64_t options) {
    (void)device;(void)block;(void)count;(void)extentCount;(void)extents;(void)options;
    return GM_UNSUPPORTED; /* Same return as High Sierra's inherited default. */
}

/* New timer options are never silently reinterpreted as old options. */
bool gm_nvme_timer_init(void *timer,uint32_t options,void *owner,void (*action)(void *,void *)) {
    if (options) return false;
    return gm_old_timer_init(timer,owner,action);
}
int gm_nvme_timer_timeout(void *timer,uint32_t options,uint64_t interval,uint64_t leeway) {
    if (options || leeway) return GM_UNSUPPORTED;
    return gm_old_timer_timeout(timer,interval);
}
int gm_nvme_timer_wake(void *timer,uint32_t options,uint64_t absolute,uint64_t leeway) {
    if (options || leeway) return GM_UNSUPPORTED;
    return gm_old_timer_wake(timer,absolute);
}

/* The inspected request pool uses the old initWithSpecification API, which is
 * preserved. These newer inherited vtable entries are unavailable on Mavericks.
 * Explicit failure is preferable to a reserved method, silent success, or access
 * to a newer kernel's private DMA state. Reachability must be audited separately.
 */
bool gm_nvme_dma_init_refcon(void *dma,void *refcon) {
    (void)dma;(void)refcon;return false;
}
bool gm_nvme_dma_init_segments(void *dma,void *segmentFn,const void *segments,
    uint32_t options,void *mapper,void *refcon) {
    (void)dma;(void)segmentFn;(void)segments;(void)options;(void)mapper;(void)refcon;
    return false;
}
int gm_nvme_dma_prepare_segments(void *dma,void *segmentFn,const void *segments,
    uint32_t options,void *mapper,uint64_t offset,uint64_t length,bool flush,bool sync) {
    (void)dma;(void)segmentFn;(void)segments;(void)options;(void)mapper;
    (void)offset;(void)length;(void)flush;(void)sync;return GM_UNSUPPORTED;
}
void *gm_nvme_dma_copy_buffer(void *dma,uint32_t direction,uint64_t length) {
    (void)dma;(void)direction;(void)length;return NULL;
}

#ifndef GM_COMPAT_TEST
kern_return_t gm_nvme_start(kmod_info_t *info,void *data) {
    (void)info;(void)data;
    gm_nvme_panic_action_key=gm_symbol_create("IOPlatformPanicAction");
    return gm_nvme_panic_action_key ? KERN_SUCCESS : KERN_FAILURE;
}
kern_return_t gm_nvme_stop(kmod_info_t *info,void *data) {
    (void)info;(void)data;
    if (gm_nvme_panic_action_key) gm_object_release(gm_nvme_panic_action_key);
    gm_nvme_panic_action_key=NULL;return KERN_SUCCESS;
}
KMOD_EXPLICIT_DECL(dev.Jaegermeister.MavericksNVMeCompatibility,"0.1.0d1",gm_nvme_start,gm_nvme_stop)
#endif
