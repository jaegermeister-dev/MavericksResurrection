#define GM_COMPAT_TEST 1
#include "MavericksNVMeCompatibility.c"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <setjmp.h>

static jmp_buf overflow;
static int panic_expected=0,flush_calls=0,timer_calls=0;
static void *expected_device;
void panic(const char *message,...) {
    if (panic_expected) longjmp(overflow,1);
    fprintf(stderr,"unexpected panic: %s\n",message);abort();
}
const void *gm_symbol_create(const char *s) { return s; }
void gm_object_release(const void *obj) { (void)obj; }
bool gm_old_timer_init(void *t,void *o,void (*a)(void *,void *)) {
    (void)t;(void)o;(void)a;++timer_calls;return true;
}
int gm_old_timer_timeout(void *t,uint64_t v) { (void)t;++timer_calls;return (int)v; }
int gm_old_timer_wake(void *t,uint64_t v) { (void)t;++timer_calls;return (int)v; }
static int fake_sync(void *d,uint64_t block,uint64_t count,uint32_t options) {
    assert(d==expected_device && block==0 && count==0 && options==0);
    ++flush_calls;return (int)0xe00002bc;
}
int main(void) {
    void *table[291]={0};table[290]=(void *)fake_sync;
    void **device=table;expected_device=&device;
    assert(gm_nvme_flush(&device)==(int)0xe00002bc && flush_calls==1);
    assert(gm_nvme_flush(NULL)==GM_BAD_ARGUMENT);
    table[290]=NULL;assert(gm_nvme_flush(&device)==GM_BAD_ARGUMENT);
    assert(gm_nvme_timer_init(NULL,0,NULL,NULL));
    assert(!gm_nvme_timer_init(NULL,1,NULL,NULL));
    assert(gm_nvme_timer_timeout(NULL,0,512,0)==512);
    assert(gm_nvme_timer_wake(NULL,0,1024,0)==1024);
    assert(gm_nvme_timer_timeout(NULL,1,512,0)==GM_UNSUPPORTED);
    assert(gm_nvme_timer_wake(NULL,0,1024,1)==GM_UNSUPPORTED);
    assert(timer_calls==3);
    char buf[8]="abc";
    assert(gm_nvme_strncat_checked(buf,"defgh",2,sizeof(buf))==buf);
    assert(strcmp(buf,"abcde")==0);
    gm_nvme_strncat_checked(buf,"fg",2,sizeof(buf));assert(strcmp(buf,"abcdefg")==0);
    panic_expected=1;
    if (!setjmp(overflow)) { gm_nvme_strncat_checked(buf,"h",1,sizeof(buf));abort(); }
    assert(strcmp(buf,"abcdefg")==0);
    memset(buf,'x',sizeof(buf));
    if (!setjmp(overflow)) { gm_nvme_strncat_checked(buf,"",0,sizeof(buf));abort(); }
    panic_expected=0;
    uint64_t flags=0x40;assert(!gm_nvme_bufattr_passive(&flags));
    assert(gm_nvme_bufattr_quickcomplete(&flags));
    assert(gm_nvme_bufattr_cpoff(&flags)==0);
    flags=0x80;assert(gm_nvme_bufattr_passive(&flags));
    assert(!gm_nvme_bufattr_quickcomplete(&flags));
    assert(!gm_nvme_unavailable_amfi_metaclass);
    assert(!gm_nvme_unavailable_entitlements(NULL,NULL));
    assert(!gm_nvme_no_cpx(NULL));
    assert(gm_nvme_provision_status(NULL,0,0,NULL,NULL,0)==GM_UNSUPPORTED);
    assert(!gm_nvme_dma_init_refcon(NULL,NULL));
    assert(!gm_nvme_dma_init_segments(NULL,NULL,NULL,0,NULL,NULL));
    assert(gm_nvme_dma_prepare_segments(NULL,NULL,NULL,0,NULL,0,0,0,0)==GM_UNSUPPORTED);
    assert(!gm_nvme_dma_copy_buffer(NULL,0,0));
    puts("PASS: flush dispatch/error propagation; timer forwarding/refusal; checked-string bounds; unsupported paths fail closed.");
    return 0;
}
