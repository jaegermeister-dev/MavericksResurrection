/* Durable snapshots for the exact NVMe driver/cache slots of an offline HFS+
 * Mavericks volume. No formatting, partitioning, kext loading or arbitrary
 * destination paths. The maintenance worker supplies its frozen root identity.
 * Integration must hold its transaction lock and journal before restore.
 */
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <sys/mount.h>
#include <sys/attr.h>
#include <sys/acl.h>
#include <sys/xattr.h>
#include <sys/file.h>
#include <copyfile.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
#include <libproc.h>
#include <signal.h>



__attribute__((noreturn)) static void gmFail(NSString *s) { @throw [NSException exceptionWithName:@"ExperimentsSnapshot" reason:s userInfo:nil]; }
static NSString *gmStoreRelative=@"Library/Application Support/MavericksResurrection/Experiments";
static NSArray *gmExperimentIDs(void) { return @[@"graphics-power",@"intel-framebuffer",@"cpu-power"]; }
static NSArray *gmSlots(void) { return @[@"System/Library/Extensions/AppleGraphicsPowerManagement.kext/Contents/Info.plist",@"System/Library/Extensions/AppleIntelFramebufferAzul.kext/Contents/MacOS/AppleIntelFramebufferAzul",@"System/Library/Extensions/IOPlatformPluginFamily.kext/Contents/PlugIns/X86PlatformPlugin.kext/Contents/Resources/Mac-06F11FD93F0323C5.plist",@"System/Library/Caches/com.apple.kext.caches",[gmStoreRelative stringByAppendingPathComponent:@"active-state.json"]]; }
static BOOL gmDirectorySlot(NSUInteger i) { return i==3; }
static NSArray *gmParents(void) { return @[@"System/Library/Extensions/AppleGraphicsPowerManagement.kext/Contents",@"System/Library/Extensions/AppleIntelFramebufferAzul.kext/Contents/MacOS",@"System/Library/Extensions/IOPlatformPluginFamily.kext/Contents/PlugIns/X86PlatformPlugin.kext/Contents/Resources",@"System/Library/Caches"]; }
static NSArray *gmChoices(void) { return @[@"000",@"100",@"010",@"001",@"110",@"101",@"011",@"111"]; }
static NSString *gmHashData(NSData *data) {
    CC_SHA256_CTX c;CC_SHA256_Init(&c);const unsigned char *p=data.bytes;NSUInteger remaining=data.length;
    while(remaining){CC_LONG n=(CC_LONG)MIN(remaining,(NSUInteger)1048576);CC_SHA256_Update(&c,p,n);p+=n;remaining-=n;}
    unsigned char d[32];char h[65];CC_SHA256_Final(d,&c);for(unsigned i=0;i<32;i++)sprintf(h+2*i,"%02x",d[i]);return [NSString stringWithUTF8String:h];
}
static NSString *gmHashFile(NSString *p) {
    int fd=open(p.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW);struct stat a,b;
    if(fd<0 || fstat(fd,&a) || !S_ISREG(a.st_mode))gmFail(@"Cannot read snapshot file.");
    CC_SHA256_CTX c;CC_SHA256_Init(&c);unsigned char block[1048576],d[32];ssize_t n;
    while((n=read(fd,block,sizeof block))!=0){if(n<0){if(errno==EINTR)continue;close(fd);gmFail(@"Snapshot read failed.");}CC_SHA256_Update(&c,block,(CC_LONG)n);}
    if(fstat(fd,&b) || a.st_ino!=b.st_ino || a.st_dev!=b.st_dev || a.st_size!=b.st_size || a.st_mtimespec.tv_sec!=b.st_mtimespec.tv_sec || a.st_mtimespec.tv_nsec!=b.st_mtimespec.tv_nsec || a.st_ctimespec.tv_sec!=b.st_ctimespec.tv_sec || a.st_ctimespec.tv_nsec!=b.st_ctimespec.tv_nsec){close(fd);gmFail(@"Snapshot input changed while reading.");}close(fd);
    char h[65];CC_SHA256_Final(d,&c);for(unsigned i=0;i<32;i++)sprintf(h+2*i,"%02x",d[i]);return [NSString stringWithUTF8String:h];
}
static void gmSync(NSString *p,BOOL directory) {
    int fd=open(p.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|(directory?O_DIRECTORY:0));
    if(fd<0 || fsync(fd)){if(fd>=0)close(fd);gmFail(@"Cannot synchronize snapshot data.");}
    if(!directory && fcntl(fd,F_FULLFSYNC)<0 && errno!=ENOTSUP && errno!=EINVAL){close(fd);gmFail(@"Cannot flush snapshot data.");}close(fd);
}
static struct stat gmStat(NSString *p,BOOL absent) {
    struct stat s={0};if(lstat(p.fileSystemRepresentation,&s)){if(absent && errno==ENOENT)return s;gmFail([@"Cannot inspect " stringByAppendingString:p]);}return s;
}
static void gmPlain(NSString *p,BOOL directory) {
    struct stat s=gmStat(p,NO);
    if(s.st_uid || (s.st_mode&0022) || (directory?!S_ISDIR(s.st_mode):(!S_ISREG(s.st_mode)||s.st_nlink!=1)))gmFail(@"Snapshot control path is not protected.");
}
static BOOL gmUUID(NSString *s) { return [s isKindOfClass:[NSString class]] && [[[NSUUID alloc]initWithUUIDString:s]autorelease]!=nil; }
static NSDictionary *gmProcess(pid_t pid) {
    struct proc_bsdinfo info={0};int n=proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof info);
    if(n!=(int)sizeof info)return nil;
    return @{@"pid":@(pid),@"seconds":@(info.pbi_start_tvsec),@"microseconds":@(info.pbi_start_tvusec)};
}
static NSArray *gmNames(NSString *p) {
    NSError *error=nil;NSArray *a=[[NSFileManager defaultManager]contentsOfDirectoryAtPath:p error:&error];if(!a)gmFail(@"Cannot enumerate snapshot directory.");
    for(NSString *n in a)if(!n.length || [n isEqual:@"."] || [n isEqual:@".."] || [n rangeOfString:@"/"].location!=NSNotFound)gmFail(@"Invalid snapshot entry name.");
    return [a sortedArrayUsingSelector:@selector(compare:)];
}
static NSDictionary *gmMetadata(NSString *p,struct stat s) {
    acl_t acl=acl_get_link_np(p.fileSystemRepresentation,ACL_TYPE_EXTENDED);NSString *aclString=@"";
    if(!acl && errno!=ENOENT)gmFail(@"Cannot read snapshot ACL.");
    if(acl){ssize_t length;char *text=acl_to_text(acl,&length);if(!text){acl_free(acl);gmFail(@"Cannot encode snapshot ACL.");}aclString=[NSString stringWithUTF8String:text];acl_free(text);acl_free(acl);if(!aclString)gmFail(@"Invalid ACL text.");}
    ssize_t length=listxattr(p.fileSystemRepresentation,NULL,0,XATTR_NOFOLLOW);if(length<0)gmFail(@"Cannot list snapshot attributes.");
    NSMutableData *names=[NSMutableData dataWithLength:length];if(length && listxattr(p.fileSystemRepresentation,names.mutableBytes,length,XATTR_NOFOLLOW)!=length)gmFail(@"Snapshot attributes changed.");
    NSMutableArray *ordered=[NSMutableArray array],*attrs=[NSMutableArray array];const char *bytes=names.bytes;
    for(ssize_t at=0;at<length;){size_t n=strnlen(bytes+at,length-at);if(!n || n==(size_t)(length-at))gmFail(@"Invalid attribute name.");NSString *name=[NSString stringWithUTF8String:bytes+at];if(!name)gmFail(@"Invalid attribute encoding.");if(![name isEqual:@"com.apple.decmpfs"])[ordered addObject:name];at+=n+1;}
    for(NSString *name in [ordered sortedArrayUsingSelector:@selector(compare:)]){
        ssize_t n=getxattr(p.fileSystemRepresentation,name.UTF8String,NULL,0,0,XATTR_NOFOLLOW);if(n<0)gmFail(@"Cannot measure snapshot attribute.");NSMutableData *data=[NSMutableData dataWithLength:n];
        if(getxattr(p.fileSystemRepresentation,name.UTF8String,data.mutableBytes,n,0,XATTR_NOFOLLOW)!=n)gmFail(@"Cannot read snapshot attribute.");[attrs addObject:@{@"name":name,@"bytes":@(n),@"sha256":gmHashData(data)}];
    }
    return @{@"mode":@(s.st_mode&07777),@"uid":@(s.st_uid),@"gid":@(s.st_gid),@"flags":@(s.st_flags&~UF_COMPRESSED),@"mtimeSeconds":@(s.st_mtimespec.tv_sec),@"mtimeNanoseconds":@(s.st_mtimespec.tv_nsec),@"acl":aclString,@"xattrs":attrs};
}
static void gmScan(NSString *base,NSString *relative,dev_t device,NSMutableArray *rows,NSMutableDictionary *links) {
    NSString *p=relative.length?[base stringByAppendingPathComponent:relative]:base;struct stat s=gmStat(p,NO);
    if(s.st_dev!=device)gmFail(@"Snapshot traversal crossed a filesystem.");
    NSString *kind=S_ISDIR(s.st_mode)?@"directory":S_ISREG(s.st_mode)?@"file":S_ISLNK(s.st_mode)?@"symlink":nil;
    if(!kind)gmFail(@"Unsupported object in a snapshot slot.");
    NSMutableDictionary *r=[[gmMetadata(p,s)mutableCopy]autorelease];r[@"path"]=relative;r[@"kind"]=kind;
    if(S_ISREG(s.st_mode)){
        r[@"sha256"]=gmHashFile(p);r[@"bytes"]=@(s.st_size);
        if(s.st_nlink>1){NSString *key=[NSString stringWithFormat:@"%llu",(unsigned long long)s.st_ino];NSMutableDictionary *item=links[key];if(!item){item=[@{@"first":relative,@"seen":@0,@"expected":@(s.st_nlink)}mutableCopy];links[key]=item;[item release];}item[@"seen"]=@([item[@"seen"]unsignedLongLongValue]+1);r[@"hardlinkTo"]=item[@"first"];}
    }else if(S_ISLNK(s.st_mode)){
        char link[PATH_MAX];ssize_t n=readlink(p.fileSystemRepresentation,link,sizeof link-1);if(n<0 || n==(ssize_t)sizeof link-1)gmFail(@"Cannot read snapshot link.");link[n]=0;NSString *dest=[NSString stringWithUTF8String:link];if(!dest)gmFail(@"Invalid snapshot link encoding.");r[@"link"]=dest;
    }
    [rows addObject:r];if(rows.count>100000)gmFail(@"Snapshot slot has too many entries.");
    if(S_ISDIR(s.st_mode))for(NSString *name in gmNames(p))gmScan(base,relative.length?[relative stringByAppendingPathComponent:name]:name,device,rows,links);
    struct stat after=gmStat(p,NO);
    if(s.st_dev==after.st_dev&&s.st_ino==after.st_ino&&s.st_mode==after.st_mode&&s.st_uid==after.st_uid&&s.st_gid==after.st_gid&&s.st_nlink==after.st_nlink&&s.st_size==after.st_size&&s.st_flags==after.st_flags&&s.st_mtimespec.tv_sec==after.st_mtimespec.tv_sec&&s.st_mtimespec.tv_nsec==after.st_mtimespec.tv_nsec&&(s.st_ctimespec.tv_sec!=after.st_ctimespec.tv_sec||s.st_ctimespec.tv_nsec!=after.st_ctimespec.tv_nsec))@throw [NSException exceptionWithName:@"SnapshotCtimeChanged" reason:[@"Snapshot status timestamp changed while scanning " stringByAppendingString:p] userInfo:nil];
    if(s.st_dev!=after.st_dev || s.st_ino!=after.st_ino || s.st_mode!=after.st_mode || s.st_uid!=after.st_uid || s.st_gid!=after.st_gid || s.st_nlink!=after.st_nlink || s.st_size!=after.st_size || s.st_flags!=after.st_flags || s.st_mtimespec.tv_sec!=after.st_mtimespec.tv_sec || s.st_mtimespec.tv_nsec!=after.st_mtimespec.tv_nsec || s.st_ctimespec.tv_sec!=after.st_ctimespec.tv_sec || s.st_ctimespec.tv_nsec!=after.st_ctimespec.tv_nsec)gmFail([NSString stringWithFormat:@"Snapshot input changed while scanning %@ (size %lld/%lld, flags %u/%u, mtime %ld.%ld/%ld.%ld, ctime %ld.%ld/%ld.%ld).",p,s.st_size,after.st_size,s.st_flags,after.st_flags,s.st_mtimespec.tv_sec,s.st_mtimespec.tv_nsec,after.st_mtimespec.tv_sec,after.st_mtimespec.tv_nsec,s.st_ctimespec.tv_sec,s.st_ctimespec.tv_nsec,after.st_ctimespec.tv_sec,after.st_ctimespec.tv_nsec]);
}
static NSArray *gmTreeOnce(NSString *p,dev_t device) {
    struct stat s=gmStat(p,YES);if(!s.st_ino)return @[];
    NSMutableArray *rows=[NSMutableArray array];NSMutableDictionary *links=[NSMutableDictionary dictionary];gmScan(p,@"",device,rows,links);
    for(NSDictionary *link in links.allValues)if(![link[@"seen"]isEqual:link[@"expected"]])gmFail(@"A snapshot slot has a hardlink outside that slot.");return rows;
}
static NSArray *gmTree(NSString *p,dev_t device) {
    BOOL owned=[p rangeOfString:@"/MavericksResurrection/Experiments/(Snapshots|Restores|Changes)/[A-F0-9-]+/(slot|displaced)-[0-9]+$" options:NSRegularExpressionSearch].location!=NSNotFound;
    for(unsigned attempt=0;attempt<3;attempt++){@try{return gmTreeOnce(p,device);}@catch(NSException *e){if(!owned||![e.name isEqual:@"SnapshotCtimeChanged"]||attempt==2)@throw;}}
    gmFail(@"Snapshot copy did not stabilize.");
}
// copyfile may update mtime while materializing a compressed file's data.
// Restore only the source timestamps after copying has finished; do not copy
// UF_COMPRESSED onto a decompressed destination. setattrlist is available on
// Yosemite and preserves timespec precision without following symbolic links.
static void gmCopyTimes(NSString *dest,struct stat source) {
    struct attrlist attributes={0};attributes.bitmapcount=ATTR_BIT_MAP_COUNT;
    attributes.commonattr=ATTR_CMN_MODTIME|ATTR_CMN_ACCTIME;
    struct {struct timespec modified,accessed;} times={source.st_mtimespec,source.st_atimespec};
    if(setattrlist(dest.fileSystemRepresentation,&attributes,&times,sizeof times,FSOPT_NOFOLLOW))gmFail(@"Cannot preserve snapshot timestamps.");
}
static void gmCopy(NSString *source,NSString *dest,dev_t device,NSMutableDictionary *links) {
    struct stat s=gmStat(source,NO);if(s.st_dev!=device || gmStat(dest,YES).st_ino)gmFail(@"Snapshot copy source/device or destination changed.");
    if(S_ISDIR(s.st_mode)){
        if(mkdir(dest.fileSystemRepresentation,0700))gmFail(@"Cannot create snapshot copy directory.");
        for(NSString *name in gmNames(source))gmCopy([source stringByAppendingPathComponent:name],[dest stringByAppendingPathComponent:name],device,links);
        if(copyfile(source.fileSystemRepresentation,dest.fileSystemRepresentation,NULL,COPYFILE_METADATA|COPYFILE_NOFOLLOW))gmFail(@"Cannot copy snapshot directory metadata.");gmSync(dest,YES);
    }else if(S_ISREG(s.st_mode)){
        NSString *key=[NSString stringWithFormat:@"%llu",(unsigned long long)s.st_ino],*first=links[key];
        if(first){if(link(first.fileSystemRepresentation,dest.fileSystemRepresentation))gmFail(@"Cannot preserve snapshot hardlinks.");}
        else{if(copyfile(source.fileSystemRepresentation,dest.fileSystemRepresentation,NULL,COPYFILE_ALL|COPYFILE_NOFOLLOW|COPYFILE_EXCL))gmFail(@"Cannot copy snapshot file.");if(s.st_nlink>1)links[key]=dest;gmCopyTimes(dest,s);gmSync(dest,NO);}
    }else if(S_ISLNK(s.st_mode)){
        if(copyfile(source.fileSystemRepresentation,dest.fileSystemRepresentation,NULL,COPYFILE_ALL|COPYFILE_NOFOLLOW|COPYFILE_EXCL))gmFail(@"Cannot preserve snapshot symbolic link.");
    }else gmFail(@"Unsupported snapshot copy object.");
}
static void gmWriteJSON(NSString *p,id value) {
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:NULL];if(!data)gmFail(@"Cannot encode snapshot receipt.");
    NSString *tmp=[p stringByAppendingFormat:@".%@.new",[NSUUID UUID].UUIDString];int fd=open(tmp.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    if(fd<0)gmFail(@"Cannot create durable snapshot record.");const char *b=data.bytes;NSUInteger n=data.length;
    while(n){ssize_t wrote=write(fd,b,n);if(wrote<0 && errno==EINTR)continue;if(wrote<=0){close(fd);gmFail(@"Cannot write snapshot record.");}b+=wrote;n-=wrote;}
    if(fsync(fd)){close(fd);gmFail(@"Cannot synchronize snapshot record.");}close(fd);gmSync(tmp,NO);
    if(rename(tmp.fileSystemRepresentation,p.fileSystemRepresentation))gmFail(@"Cannot publish snapshot record.");gmSync(p.stringByDeletingLastPathComponent,YES);
}

@interface GMExperimentsSnapshotStore:NSObject {
    NSString *root,*volumeID,*store;struct stat rootStat;int rootFD,lockFD;
}
- (id)initWithRoot:(NSString *)path device:(unsigned long long)device inode:(unsigned long long)inode;
- (NSDictionary *)capture;
- (NSDictionary *)assessment:(NSString *)model;
- (NSDictionary *)repairInputs;
- (NSDictionary *)verify:(NSString *)identifier;
- (NSDictionary *)restore:(NSString *)identifier;
- (NSDictionary *)pending;
- (NSDictionary *)begin:(NSString *)snapshot candidate:(NSString *)candidate;
- (NSDictionary *)recover;
- (NSDictionary *)baseline;
- (NSDictionary *)managedState;
- (NSDictionary *)apply:(NSString *)transaction payload:(NSString *)payload;
- (NSDictionary *)commit:(NSString *)transaction receipt:(NSDictionary *)receipt;
@end
@implementation GMExperimentsSnapshotStore
- (void)dealloc {if(rootFD>=0)close(rootFD);if(lockFD>=0)close(lockFD);[root release];[volumeID release];[store release];[super dealloc];}
- (NSString *)uuid {
    struct attrlist request={0};request.bitmapcount=ATTR_BIT_MAP_COUNT;request.volattr=ATTR_VOL_INFO|ATTR_VOL_UUID;
    struct {uint32_t length;unsigned char uuid[16];} result={0};
    if(getattrlist(root.fileSystemRepresentation,&request,&result,sizeof result,0) || result.length!=sizeof result)gmFail(@"Cannot read the target filesystem UUID.");
    return [[[NSUUID alloc]initWithUUIDBytes:result.uuid]autorelease].UUIDString;
}
- (void)guard {
    struct stat s=gmStat(root,NO),opened,host;struct statfs fs;
    if(fstat(rootFD,&opened)||fstatfs(rootFD,&fs)||stat("/",&host)||s.st_dev!=rootStat.st_dev||s.st_ino!=rootStat.st_ino||opened.st_dev!=s.st_dev||opened.st_ino!=s.st_ino||host.st_dev==s.st_dev||strcmp(fs.f_fstypename,"hfs")||strcmp(fs.f_mntonname,root.fileSystemRepresentation)||(fs.f_flags&MNT_RDONLY)||![[self uuid]isEqual:volumeID])gmFail(@"Offline Mavericks volume identity or access changed.");
    // Apple's restored installer filesystem is HFS+ without a filesystem journal.
    // The USB-specific executable preserves that original format; its own change
    // records and snapshots are separately flushed before any replacement.
}
- (NSString *)path:(NSString *)relative absent:(BOOL)absent {
    [self guard];NSString *p=root;NSArray *parts=[relative componentsSeparatedByString:@"/"];
    for(NSUInteger i=0;i<parts.count;i++){
        NSString *part=parts[i];if(!part.length||[part isEqual:@"."]||[part isEqual:@".."])gmFail(@"Unsafe snapshot path.");p=[p stringByAppendingPathComponent:part];struct stat s=gmStat(p,absent&&i+1==parts.count);
        if(!s.st_ino)return p;
        if(s.st_dev!=rootStat.st_dev || S_ISLNK(s.st_mode) || (i+1<parts.count && (!S_ISDIR(s.st_mode)||s.st_uid||(s.st_mode&0022))))gmFail(@"Linked, writable or cross-volume snapshot parent.");
    }return p;
}
- (void)makePrivate:(NSString *)relative {
    NSString *partial=@"";for(NSString *part in [relative componentsSeparatedByString:@"/"]){partial=partial.length?[partial stringByAppendingPathComponent:part]:part;NSString *p=[self path:partial absent:YES];if(!gmStat(p,YES).st_ino){if(mkdir(p.fileSystemRepresentation,[partial hasPrefix:gmStoreRelative]?0700:0755))gmFail(@"Cannot create snapshot storage.");gmSync(p.stringByDeletingLastPathComponent,YES);}gmPlain(p,YES);}
}
- (void)requireSpace:(NSArray *)slots copies:(unsigned)copies {
    unsigned long long bytes=0;for(NSDictionary *slot in slots)for(NSDictionary *row in slot[@"entries"]){unsigned long long n=[row[@"bytes"]unsignedLongLongValue];if(n>ULLONG_MAX-bytes)gmFail(@"Snapshot size overflow.");bytes+=n;}
    struct statfs fs;if(fstatfs(rootFD,&fs)||bytes>(ULLONG_MAX-67108864)/copies)gmFail(@"Cannot measure snapshot space.");
    unsigned long long available=(unsigned long long)fs.f_bavail*(unsigned long long)fs.f_bsize;
    if(available<bytes*copies+67108864)gmFail(@"The Mavericks volume needs more free space to preserve drivers and caches before this change.");
}
- (void)resolveStore {
    NSString *parent=@"Library/Application Support",*base=[self path:parent absent:YES];
    if(!gmStat(base,YES).st_ino)return;
    gmPlain(base,YES);NSMutableArray *matches=[NSMutableArray array];
    for(NSString *name in gmNames(base)){
        NSString *relative=[[parent stringByAppendingPathComponent:name]stringByAppendingPathComponent:@"Experiments"];
        NSString *app=[base stringByAppendingPathComponent:name];struct stat a=gmStat(app,YES);
        if(!S_ISDIR(a.st_mode)||a.st_dev!=rootStat.st_dev||a.st_uid||(a.st_mode&0022))continue;
        NSString *candidate=[root stringByAppendingPathComponent:relative];struct stat st=gmStat(candidate,YES);
        if(!st.st_ino)continue;
        if(!S_ISDIR(st.st_mode)||st.st_dev!=rootStat.st_dev||st.st_uid||(st.st_mode&0022)){
            if([relative isEqual:gmStoreRelative])gmFail(@"The maintenance store is not protected.");continue;
        }
        BOOL recordFound=[relative isEqual:gmStoreRelative];
        for(NSString *file in @[@"initial-state.json",@"OriginalBaseline.json",@"active-state.json",@"pending.json"]){
            NSString *filePath=[candidate stringByAppendingPathComponent:file];struct stat f=gmStat(filePath,YES);
            if(!f.st_ino)continue;
            if(!S_ISREG(f.st_mode)||f.st_uid||(f.st_mode&0022)||f.st_nlink!=1||f.st_dev!=rootStat.st_dev||f.st_size>65536)gmFail(@"An existing maintenance record is not protected.");
            NSData *data=[NSData dataWithContentsOfFile:filePath];id record=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL]:nil;
            if(![record isKindOfClass:[NSDictionary class]]||![record[@"schema"]isEqual:@1])gmFail(@"An existing maintenance record is invalid.");
            recordFound=YES;
        }
        if(recordFound)[matches addObject:relative];
    }
    if(matches.count>1)gmFail(@"More than one maintenance history exists for this installation; no driver was changed.");
    if(matches.count)gmStoreRelative=[matches[0]copy];
}
- (id)initWithRoot:(NSString *)path device:(unsigned long long)device inode:(unsigned long long)inode {
    if((self=[super init])){
        rootFD=lockFD=-1;if(geteuid()||![path hasPrefix:@"/"]||![path isEqual:[[path stringByStandardizingPath]stringByResolvingSymlinksInPath]]||[path isEqual:@"/"])gmFail(@"A canonical offline volume root and administrator access are required.");
        root=[path copy];rootStat=gmStat(root,NO);if(!S_ISDIR(rootStat.st_mode)||(unsigned long long)rootStat.st_dev!=device||rootStat.st_ino!=inode)gmFail(@"The selected root identity changed.");
        rootFD=open(root.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(rootFD<0)gmFail(@"Cannot hold the selected root.");volumeID=[[self uuid]copy];[self guard];
        NSString *os=[self path:@"System/Library/CoreServices/SystemVersion.plist" absent:NO];NSDictionary *version=[NSDictionary dictionaryWithContentsOfFile:os];
        NSString *build=version[@"ProductBuildVersion"];if(![version[@"ProductVersion"]isEqual:@"10.9.5"]||![build isKindOfClass:[NSString class]]||![build hasPrefix:@"13F"]||build.length<4||build.length>12||[[build substringFromIndex:3]rangeOfCharacterFromSet:[[NSCharacterSet decimalDigitCharacterSet]invertedSet]].location!=NSNotFound)gmFail(@"Select an installed Mavericks 10.9.5 filesystem.");
        NSString *installer=[root stringByAppendingPathComponent:@"System/Installation/CDIS"];
        if(gmStat(installer,YES).st_ino)gmFail(@"Installer media is not an installed Mavericks system.");
        for(NSString *p in gmParents())gmPlain([self path:p absent:NO],YES);
        [self resolveStore];
        [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Snapshots"]];store=[[root stringByAppendingPathComponent:gmStoreRelative]copy];
        NSString *lock=[self path:[gmStoreRelative stringByAppendingPathComponent:@"Snapshot.lock"] absent:YES];lockFD=open(lock.fileSystemRepresentation,O_RDWR|O_CREAT|O_NOFOLLOW,0600);gmPlain(lock,NO);
        if(lockFD<0||flock(lockFD,LOCK_EX|LOCK_NB))gmFail(@"Another snapshot operation is running.");
    }return self;
}
- (NSString *)folder:(NSString *)identifier {
    if(!gmUUID(identifier)||![identifier isEqual:identifier.uppercaseString])gmFail(@"Invalid snapshot identifier.");
    return [self path:[[gmStoreRelative stringByAppendingPathComponent:@"Snapshots"]stringByAppendingPathComponent:identifier] absent:NO];
}
- (NSDictionary *)capture {
    [self guard];NSString *identifier=[NSUUID UUID].UUIDString,*folder=[store stringByAppendingFormat:@"/Snapshots/%@",identifier];
    NSMutableArray *slots=[NSMutableArray array],*parents=[NSMutableArray array];
    for(NSUInteger i=0;i<gmSlots().count;i++){
        NSString *source=[self path:gmSlots()[i] absent:YES];struct stat s=gmStat(source,YES);
        if(s.st_ino && (gmDirectorySlot(i)?!S_ISDIR(s.st_mode):(!S_ISREG(s.st_mode)||s.st_nlink!=1)))gmFail(@"An Post-update snapshot slot has an unexpected type.");
        [slots addObject:@{@"path":gmSlots()[i],@"entries":gmTree(source,rootStat.st_dev)}];
    }
    [self requireSpace:slots copies:2];if(mkdir(folder.fileSystemRepresentation,0700))gmFail(@"Cannot create a new snapshot.");
    for(NSUInteger i=0;i<gmSlots().count;i++){
        NSString *relative=gmSlots()[i],*source=[self path:relative absent:YES],*copy=[folder stringByAppendingFormat:@"/slot-%lu",(unsigned long)i];NSArray *before=slots[i][@"entries"];
        if(before.count){gmCopy(source,copy,rootStat.st_dev,[NSMutableDictionary dictionary]);if(![before isEqual:gmTree(copy,rootStat.st_dev)])gmFail(@"Snapshot copy metadata or data differs.");}
        if(![before isEqual:gmTree(source,rootStat.st_dev)])gmFail(@"Source changed during snapshot capture.");
    }
    for(NSUInteger i=0;i<gmParents().count;i++){
        NSString *p=[self path:gmParents()[i] absent:NO],*copy=[folder stringByAppendingFormat:@"/parent-%lu",(unsigned long)i];struct stat s=gmStat(p,NO);
        if(mkdir(copy.fileSystemRepresentation,0700)||copyfile(p.fileSystemRepresentation,copy.fileSystemRepresentation,NULL,COPYFILE_METADATA|COPYFILE_NOFOLLOW))gmFail(@"Cannot capture parent metadata.");
        NSDictionary *metadata=gmMetadata(p,s);if(![metadata isEqual:gmMetadata(copy,gmStat(copy,NO))])gmFail(@"Parent metadata copy differs.");gmSync(copy,YES);[parents addObject:@{@"path":gmParents()[i],@"metadata":metadata}];
    }
    [self guard];NSDictionary *record=@{@"schema":@1,@"complete":@YES,@"id":identifier,@"volumeUUID":volumeID,@"slots":slots,@"parents":parents};
    gmWriteJSON([folder stringByAppendingPathComponent:@"Snapshot.json"],record);gmSync(folder,YES);gmSync(folder.stringByDeletingLastPathComponent,YES);
    [self verify:identifier];return @{@"id":identifier,@"verified":@YES,@"volumeUUID":volumeID};
}
- (NSDictionary *)verify:(NSString *)identifier {
    [self guard];NSString *folder=[self folder:identifier];gmPlain(folder,YES);NSString *receipt=[folder stringByAppendingPathComponent:@"Snapshot.json"];gmPlain(receipt,NO);
    NSData *data=[NSData dataWithContentsOfFile:receipt];if(!data||data.length>64*1024*1024)gmFail(@"Snapshot receipt unavailable or oversized.");
    NSDictionary *r=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    if(![r isKindOfClass:[NSDictionary class]]||![r[@"schema"]isEqual:@1]||![r[@"complete"]isEqual:@YES]||![r[@"id"]isEqual:identifier]||![r[@"volumeUUID"]isEqual:volumeID]||![r[@"slots"]isKindOfClass:[NSArray class]]||[r[@"slots"]count]!=gmSlots().count||![r[@"parents"]isKindOfClass:[NSArray class]]||[r[@"parents"]count]!=gmParents().count)gmFail(@"Invalid or foreign snapshot receipt.");
    NSMutableArray *names=[NSMutableArray arrayWithObject:@"Snapshot.json"];
    for(NSUInteger i=0;i<gmSlots().count;i++){
        NSDictionary *slot=r[@"slots"][i];NSString *name=[NSString stringWithFormat:@"slot-%lu",(unsigned long)i];
        if(![slot isKindOfClass:[NSDictionary class]]||![slot[@"path"]isEqual:gmSlots()[i]]||![slot[@"entries"]isKindOfClass:[NSArray class]])gmFail(@"Snapshot slot inventory differs.");
        NSString *p=[folder stringByAppendingPathComponent:name];if(![slot[@"entries"]isEqual:gmTree(p,rootStat.st_dev)])gmFail(@"Snapshot data or metadata verification failed.");if([slot[@"entries"]count])[names addObject:name];
    }
    for(NSUInteger i=0;i<gmParents().count;i++){
        NSDictionary *p=r[@"parents"][i];NSString *name=[NSString stringWithFormat:@"parent-%lu",(unsigned long)i],*copy=[folder stringByAppendingPathComponent:name];struct stat s=gmStat(copy,NO);
        if(!S_ISDIR(s.st_mode)||s.st_dev!=rootStat.st_dev||gmNames(copy).count||![p isKindOfClass:[NSDictionary class]]||![p[@"path"]isEqual:gmParents()[i]]||![p[@"metadata"]isEqual:gmMetadata(copy,s)])gmFail(@"Snapshot parent metadata differs.");[names addObject:name];
    }
    if(![gmNames(folder)isEqual:[names sortedArrayUsingSelector:@selector(compare:)]])gmFail(@"Unexpected snapshot contents.");[self guard];return r;
}
- (NSDictionary *)restore:(NSString *)identifier {
    NSDictionary *r=[self verify:identifier];NSString *folder=[self folder:identifier],*restoreID=[NSUUID UUID].UUIDString;
    [self requireSpace:r[@"slots"] copies:1];
    [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Restores"]];NSString *work=[store stringByAppendingFormat:@"/Restores/%@",restoreID];if(mkdir(work.fileSystemRepresentation,0700))gmFail(@"Cannot stage snapshot restoration.");
    // Copy and verify every slot before moving any active driver/cache path.
    for(NSUInteger i=0;i<gmSlots().count;i++){
        NSString *dest=[self path:gmSlots()[i] absent:YES];struct stat existing=gmStat(dest,YES);
        if(existing.st_ino && (gmDirectorySlot(i)?!S_ISDIR(existing.st_mode):(!S_ISREG(existing.st_mode)||existing.st_nlink!=1)))gmFail(@"A managed restoration slot has an unexpected type.");
        if(existing.st_ino)gmTree(dest,rootStat.st_dev); // Refuse nested mounts and escaping hardlinks before moving any slot.
        if([r[@"slots"][i][@"entries"]count]){NSString *name=[NSString stringWithFormat:@"slot-%lu",(unsigned long)i],*copy=[work stringByAppendingPathComponent:name];gmCopy([folder stringByAppendingPathComponent:name],copy,rootStat.st_dev,[NSMutableDictionary dictionary]);if(![r[@"slots"][i][@"entries"]isEqual:gmTree(copy,rootStat.st_dev)])gmFail(@"Restoration staging differs.");}
    }
    gmWriteJSON([work stringByAppendingPathComponent:@"Restore.json"],@{@"schema":@1,@"snapshot":identifier,@"volumeUUID":volumeID,@"phase":@"prepared"});[self verify:identifier];
    for(NSUInteger i=0;i<gmSlots().count;i++){
        NSString *dest=[self path:gmSlots()[i] absent:YES],*displaced=[work stringByAppendingFormat:@"/displaced-%lu",(unsigned long)i];
        if(gmStat(dest,YES).st_ino && rename(dest.fileSystemRepresentation,displaced.fileSystemRepresentation))gmFail(@"Cannot retain the previous restoration slot.");
        if([r[@"slots"][i][@"entries"]count]){NSString *copy=[work stringByAppendingFormat:@"/slot-%lu",(unsigned long)i];if(rename(copy.fileSystemRepresentation,dest.fileSystemRepresentation))gmFail(@"Snapshot restoration is incomplete; recovery data was retained.");}
        gmSync(dest.stringByDeletingLastPathComponent,YES);gmSync(work,YES);
    }
    for(NSUInteger i=0;i<gmParents().count;i++){
        NSString *from=[folder stringByAppendingFormat:@"/parent-%lu",(unsigned long)i],*to=[self path:gmParents()[i] absent:NO];
        if(copyfile(from.fileSystemRepresentation,to.fileSystemRepresentation,NULL,COPYFILE_METADATA|COPYFILE_NOFOLLOW))gmFail(@"Cannot restore driver/cache parent metadata.");gmSync(to,YES);
    }
    for(NSUInteger i=0;i<gmSlots().count;i++)if(![r[@"slots"][i][@"entries"]isEqual:gmTree([self path:gmSlots()[i] absent:YES],rootStat.st_dev)])gmFail(@"Restored slot differs from its snapshot.");
    for(NSUInteger i=0;i<gmParents().count;i++){NSString *p=[self path:gmParents()[i] absent:NO];if(![r[@"parents"][i][@"metadata"]isEqual:gmMetadata(p,gmStat(p,NO))])gmFail(@"Restored parent metadata differs.");}
    [self guard];gmWriteJSON([work stringByAppendingPathComponent:@"Restore.json"],@{@"schema":@1,@"snapshot":identifier,@"volumeUUID":volumeID,@"phase":@"complete"});return @{@"restored":@YES,@"snapshot":identifier,@"volumeUUID":volumeID,@"retainedDisplacedState":restoreID};
}
- (NSDictionary *)pending {
    NSString *path=[self path:[gmStoreRelative stringByAppendingPathComponent:@"pending.json"] absent:YES];if(!gmStat(path,YES).st_ino)return nil;gmPlain(path,NO);
    NSData *data=[NSData dataWithContentsOfFile:path];if(!data||data.length>65536)gmFail(@"The pending post-update repair cannot be read.");NSDictionary *p=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    if(![p isKindOfClass:[NSDictionary class]]||![p[@"schema"]isEqual:@1]||![p[@"phase"]isEqual:@"pending"]||!gmUUID(p[@"id"])||!gmUUID(p[@"snapshot"])||![p[@"volumeUUID"]isEqual:volumeID]||![gmChoices()containsObject:p[@"candidate"]]||![p[@"owner"]isKindOfClass:[NSDictionary class]]||![p[@"owner"][@"pid"]isKindOfClass:[NSNumber class]]||[p[@"owner"][@"pid"]longLongValue]<1||[p[@"owner"][@"pid"]longLongValue]>INT_MAX||![p[@"owner"][@"seconds"]isKindOfClass:[NSNumber class]]||![p[@"owner"][@"microseconds"]isKindOfClass:[NSNumber class]])gmFail(@"The pending repair record is invalid or belongs to another filesystem.");return p;
}
- (NSDictionary *)begin:(NSString *)snapshot candidate:(NSString *)candidate {
    if([self pending])gmFail(@"An unfinished post-update repair must be recovered first.");
    if(![gmChoices()containsObject:candidate])gmFail(@"Unsupported repair model.");
    NSDictionary *r=[self verify:snapshot];
    for(NSUInteger i=0;i<gmSlots().count;i++)if(![r[@"slots"][i][@"entries"]isEqual:gmTree([self path:gmSlots()[i] absent:YES],rootStat.st_dev)])gmFail(@"Driver or cache state changed before the transaction started.");
    for(NSUInteger i=0;i<gmParents().count;i++){NSString *p=[self path:gmParents()[i] absent:NO];if(![r[@"parents"][i][@"metadata"]isEqual:gmMetadata(p,gmStat(p,NO))])gmFail(@"Driver/cache directory metadata changed before the transaction started.");}
    // CLI calls are owned by the persistent maintenance worker that launches us.
    // A matching process start time avoids treating a reused PID as that worker.
    NSDictionary *owner=gmProcess(getppid());if(!owner)gmFail(@"Cannot identify the maintenance worker.");
    NSDictionary *pending=@{@"schema":@1,@"phase":@"pending",@"id":[NSUUID UUID].UUIDString,@"snapshot":snapshot,@"volumeUUID":volumeID,@"candidate":candidate,@"owner":owner,@"repairInputs":[self repairInputs],@"changedIndices":[self assessment:candidate][@"changedIndices"]};
    [self guard];gmWriteJSON([store stringByAppendingPathComponent:@"pending.json"],pending);
    if(![pending isEqual:[self pending]])gmFail(@"The pending repair record failed readback.");return pending;
}
- (NSDictionary *)recover {
    NSDictionary *p=[self pending];if(!p)return @{@"status":@"nothing-to-recover"};
    NSDictionary *live=gmProcess([p[@"owner"][@"pid"]intValue]);
    if(!live && (kill([p[@"owner"][@"pid"]intValue],0)==0 || errno!=ESRCH))gmFail(@"Cannot determine whether the original maintenance worker has stopped.");
    if([live isEqual:p[@"owner"]] && ![live isEqual:gmProcess(getppid())])gmFail(@"The original post-update repair worker is still running.");
    // Keep pending.json intact through every verification and restoration step.
    // Any failure, kill or disconnect leaves a complete snapshot to retry.
    NSDictionary *restored=[self restore:p[@"snapshot"]];
    if(![p isEqual:[self pending]])gmFail(@"The NVMe recovery journal changed.");
    [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Journal"]];
    NSString *archive=[store stringByAppendingFormat:@"/Journal/%@-recovered.json",p[@"id"]];
    if(gmStat(archive,YES).st_ino){
        // A previous recovery may have flushed its result just before crashing
        // while retiring pending.json. Accept only that exact journal entry.
        gmPlain(archive,NO);NSData *data=[NSData dataWithContentsOfFile:archive];
        NSDictionary *earlier=data&&data.length<=65536?[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL]:nil;
        if(![earlier isKindOfClass:[NSDictionary class]]||![earlier[@"schema"]isEqual:@1]||![earlier[@"status"]isEqual:@"recovered"]||![earlier[@"transaction"]isEqual:p]||![earlier[@"restoration"][@"snapshot"]isEqual:p[@"snapshot"]]||![earlier[@"restoration"][@"volumeUUID"]isEqual:volumeID])gmFail(@"Conflicting recovery evidence; pending record retained.");
    }else gmWriteJSON(archive,@{@"schema":@1,@"status":@"recovered",@"transaction":p,@"restoration":restored});
    NSString *pending=[store stringByAppendingPathComponent:@"pending.json"];
    if(unlink(pending.fileSystemRepresentation))gmFail(@"Recovered state verified, but the pending record could not be retired.");gmSync(store,YES);
    return @{@"status":@"recovered",@"transaction":p[@"id"],@"snapshot":p[@"snapshot"]};
}
#include "ExperimentsManagedState.inc"
@end
#ifndef MR_EXPERIMENTS_SNAPSHOT_TEST
int main(int argc,char **argv) {
    @autoreleasepool {@try {
        if(argc<5||argc>7)gmFail(@"Usage: ExperimentsSnapshotStore /offline-volume device inode capture|verify|begin|pending|recover|baseline|state|apply|commit [identifier] [candidate|payload|receipt]");
        char *e1=NULL,*e2=NULL;unsigned long long dev=strtoull(argv[2],&e1,10),ino=strtoull(argv[3],&e2,10);if(!dev||!ino||*e1||*e2)gmFail(@"Invalid expected filesystem identity.");
        NSString *verb=[NSString stringWithUTF8String:argv[4]];
        if(!((argc==5&&[@[@"location",@"capture",@"pending",@"recover",@"baseline",@"state"]containsObject:verb])||(argc==6&&[@[@"verify",@"assessment"]containsObject:verb])||(argc==7&&[@[@"begin",@"apply",@"commit"]containsObject:verb])))gmFail(@"Unexpected snapshot operation.");
        GMExperimentsSnapshotStore *s=[[[GMExperimentsSnapshotStore alloc]initWithRoot:[NSString stringWithUTF8String:argv[1]] device:dev inode:ino]autorelease];NSDictionary *result;
        if([verb isEqual:@"location"]){NSData *location=[NSJSONSerialization dataWithJSONObject:@{@"relative":gmStoreRelative} options:0 error:NULL];fwrite(location.bytes,1,location.length,stdout);return 0;}
        if([verb isEqual:@"assessment"]&&argc==6)result=[s assessment:[NSString stringWithUTF8String:argv[5]]];else if([verb isEqual:@"capture"]&&argc==5)result=[s capture];else if([verb isEqual:@"verify"]&&argc==6)result=@{@"verified":@YES,@"id":[s verify:[NSString stringWithUTF8String:argv[5]]][@"id"]};else if([verb isEqual:@"begin"]&&argc==7)result=[s begin:[NSString stringWithUTF8String:argv[5]] candidate:[NSString stringWithUTF8String:argv[6]]];else if([verb isEqual:@"pending"]&&argc==5)result=@{@"pending":[s pending]?:[NSNull null]};else if([verb isEqual:@"recover"])result=[s recover];else if([verb isEqual:@"baseline"])result=[s baseline];else if([verb isEqual:@"state"])result=[s managedState];else if([verb isEqual:@"apply"])result=[s apply:[NSString stringWithUTF8String:argv[5]] payload:[NSString stringWithUTF8String:argv[6]]];else if([verb isEqual:@"commit"]){if(strlen(argv[6])>65536)gmFail(@"Cache receipt is oversized.");NSData *data=[[NSString stringWithUTF8String:argv[6]]dataUsingEncoding:NSUTF8StringEncoding];result=[s commit:[NSString stringWithUTF8String:argv[5]] receipt:[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL]];}else gmFail(@"Unexpected snapshot operation.");
        NSData *json=[NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];fwrite(json.bytes,1,json.length,stdout);fputc('\n',stdout);return 0;
    }@catch(NSException *e){fprintf(stderr,"%s\n",e.reason.UTF8String);return 1;}}
}
#endif
