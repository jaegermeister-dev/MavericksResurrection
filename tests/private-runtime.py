#!/usr/bin/env python3
"""Compare two BundledTools folders using a new disposable image. Run as root.
Usage: private-runtime.py NEW_TEST_DIRECTORY ORIGINAL_TOOLS REBUILT_TOOLS
The image is detached after testing; no existing installation is modified.
"""

import pathlib,subprocess,os,json,plistlib,hashlib,sys
work=pathlib.Path(sys.argv[1]).resolve()
old=pathlib.Path(sys.argv[2]).resolve()
new=pathlib.Path(sys.argv[3]).resolve()
assert os.geteuid()==0
assert not work.exists()
work.mkdir(mode=0o700)
mount=work/'mounted-fixture';mount.mkdir()
image=work/'fixture.dmg'
def run(args,**kw):
    return subprocess.run([str(x) for x in args],check=True,capture_output=True,timeout=90,**kw)
run(['/usr/bin/hdiutil','create','-size','64m','-fs','HFS+','-volname','MRRuntimeFixture',image])
attached=False
result={'usedDisposableImage':True,'installationsModified':False,'runs':{}}
try:
    run(['/usr/bin/hdiutil','attach','-nobrowse','-owners','on','-mountpoint',mount,image])
    attached=True
    info=plistlib.loads(run(['/usr/sbin/diskutil','info','-plist',mount]).stdout)
    assert info['FilesystemType']=='hfs' and info['MountPoint']==str(mount)
    (mount/'fixture-marker').write_bytes(b'MAVERICKS_RUNTIME_DISPOSABLE_FIXTURE\n')
    source=work/'probe.c'
    source.write_text(r'''
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <stdlib.h>
#include <dlfcn.h>
#include <sys/stat.h>
int main(void) {
    char text[128]={0}; FILE *f=fopen("/fixture-marker","r");
    if(!f || !fgets(text,sizeof(text),f))return 10;
    fclose(f);
    if(strcmp(text,"MAVERICKS_RUNTIME_DISPOSABLE_FIXTURE\n"))return 11;
    if(getenv("GM_PRIVATE_ROOT") || getenv("DYLD_INSERT_LIBRARIES"))return 12;
    if(access("/System/Library/CoreServices/SystemVersion.plist",F_OK)==0)return 13;
    f=fopen("/probe-output","w");if(!f)return 14;
    fputs("PRIVATE_IMAGE_WRITE_OK\n",f);fclose(f);
    void *handle=dlopen("/usr/lib/libspindump.dylib",RTLD_LAZY);
    if(handle && !dlsym(handle,"dscsym_save_nuggets_for_current_caches"))return 15;
    if(handle)dlclose(handle);
    puts("PRIVATE_ROOT_AND_OPTIONAL_LIBRARY_CHECKS_PASSED");return 0;
}
''')
    probe=work/'runtime-probe'
    run(['/usr/bin/clang','-arch','x86_64','-mmacosx-version-min=10.10','-O2',source,'-o',probe])
    run(['/usr/bin/codesign','--force','--sign','-',probe])
    for label,tools in [('tested',old),('privacy-cleaned',new)]:
        private=work/(label+'-private');private.mkdir(mode=0o700)
        for src,name in [(tools/'ImageRuntimeRoot.dylib','ImageRuntimeRoot.dylib'),(tools/'ImageRuntimeLaunch','ImageRuntimeLaunch'),(probe,'runtime-probe')]:
            p=private/name;p.write_bytes(src.read_bytes());p.chmod(0o755)
        s=mount.stat()
        p=run([private/'ImageRuntimeLaunch',mount,str(s.st_dev),str(s.st_ino),private/'ImageRuntimeRoot.dylib',private/'runtime-probe','makewhatis'])
        stdout=p.stdout.decode();stderr=p.stderr.decode()
        assert 'GM_HOST_WRITES_DENIED' in stderr and 'GM_HOST_RUNTIME_ROOTED' in stderr
        assert 'PRIVATE_ROOT_AND_OPTIONAL_LIBRARY_CHECKS_PASSED' in stdout
        assert (mount/'probe-output').read_text()=='PRIVATE_IMAGE_WRITE_OK\n'
        assert not (private/'sandbox-denied-write').exists()
        result['runs'][label]={'exitCode':p.returncode,'stdout':stdout,'stderr':stderr,'hostWriteCanaryDenied':True,'privateImageWritePassed':True}
    assert result['runs']['tested']==result['runs']['privacy-cleaned']
    result['sameBehaviour']=True
finally:
    if attached:
        run(['/usr/bin/hdiutil','detach',mount])
        result['fixtureDetached']=True
    (work/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
