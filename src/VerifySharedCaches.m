/* Verify original Mavericks dyld cache tables and their library inventories.
 * Read-only. No host libraries or per-install UUID/addresses are prescribed. */
#import <Foundation/Foundation.h>
#include <sys/stat.h>
#include <sys/mount.h>
#include <mach-o/loader.h>
#include <limits.h>
#include <unistd.h>
static void fail(NSString*s){@throw [NSException exceptionWithName:@"MavericksSharedCaches" reason:s userInfo:nil];}
static uint32_t u32(const unsigned char*p){uint32_t v;memcpy(&v,p,4);return v;}
static uint64_t u64(const unsigned char*p){uint64_t v;memcpy(&v,p,8);return v;}
int main(int argc,char**argv){@autoreleasepool{@try{
 if(argc!=5)return 64;NSString*root=[NSString stringWithUTF8String:argv[1]];
 struct stat s,host;struct statfs fs;char*end=NULL;unsigned long long dev=strtoull(argv[2],&end,10);if(!*argv[2]||*end)fail(@"Bad device");unsigned long long ino=strtoull(argv[3],&end,10);if(!*argv[3]||*end)fail(@"Bad inode");
 if(![[root stringByResolvingSymlinksInPath] isEqual:root]||stat(root.fileSystemRepresentation,&s)||stat("/",&host)||s.st_dev==host.st_dev||statfs(root.fileSystemRepresentation,&fs)||strcmp(fs.f_fstypename,"hfs")||strcmp(fs.f_mntonname,root.fileSystemRepresentation)||s.st_dev!=dev||s.st_ino!=ino)fail(@"Offline cache filesystem changed");
 NSData*input=[NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[4]]];NSDictionary*catalog=input?[NSJSONSerialization JSONObjectWithData:input options:0 error:NULL]:nil;
 if(![catalog[@"schema"] isEqual:@1]||![catalog[@"build"] isEqual:@"13F34"])fail(@"Invalid native cache inventory");
 NSMutableDictionary*counts=[NSMutableDictionary dictionary];
 for(NSString*arch in @[@"i386",@"x86_64"]){
  NSString*p=[root stringByAppendingPathComponent:[@"private/var/db/dyld/dyld_shared_cache_" stringByAppendingString:arch]];struct stat f;
  if(![[p stringByResolvingSymlinksInPath] isEqual:p]||lstat(p.fileSystemRepresentation,&f)||!S_ISREG(f.st_mode)||f.st_dev!=s.st_dev||f.st_uid||f.st_gid||(f.st_mode&07777)!=0644)fail(@"Invalid cache path/metadata");
  NSData*d=[NSData dataWithContentsOfFile:p options:NSDataReadingMappedIfSafe error:NULL];if(d.length<104)fail(@"Missing shared cache header");const unsigned char*b=d.bytes;
  const char*magic=[arch isEqual:@"i386"]?"dyld_v1    i386":"dyld_v1  x86_64";if(memcmp(b,magic,strlen(magic)))fail(@"Wrong cache architecture");
  uint32_t mo=u32(b+16),mc=u32(b+20),io=u32(b+24),ic=u32(b+28);
  if(mc!=3||mo<104||(uint64_t)mo+32*mc>d.length||!ic||(uint64_t)io+32*ic>d.length)fail(@"Truncated cache tables");
  NSMutableSet*found=[NSMutableSet set];
  for(unsigned i=0;i<mc;i++){const unsigned char*m=b+mo+32*i;uint64_t off=u64(m+16),size=u64(m+8);if(off>d.length||size>d.length-off)fail(@"Invalid mapped cache range");}
  for(unsigned i=0;i<ic;i++){
   const unsigned char*im=b+io+32*i;uint64_t address=u64(im);uint32_t po=u32(im+24);
   if(po>=d.length)fail(@"Invalid image path offset");const char*name=(const char*)b+po;const char*endName=memchr(name,0,MIN((NSUInteger)PATH_MAX,d.length-po));if(!endName||name[0]!='/')fail(@"Missing absolute cached library path");
   NSString*lib=[NSString stringWithUTF8String:name];if(!lib||[found containsObject:lib])fail(@"Duplicate cached image");[found addObject:lib];
   BOOL mapped=NO;for(unsigned j=0;j<mc;j++){const unsigned char*m=b+mo+32*j;uint64_t start=u64(m),size=u64(m+8),file=u64(m+16);if(address>=start&&address-start<size){uint64_t off=file+address-start;if(off+32>d.length)fail(@"Invalid cached Mach-O");uint32_t expected=[arch isEqual:@"i386"]?MH_MAGIC:MH_MAGIC_64;if(u32(b+off)!=expected)fail(@"Cached image has wrong Mach-O architecture");mapped=YES;break;}}
   if(!mapped)fail(@"Cached image is outside its mappings");
  }
  NSSet*wanted=[NSSet setWithArray:catalog[@"libraries"][arch]];
  if(![found isEqualToSet:wanted])fail([NSString stringWithFormat:@"%@ cached library inventory differs: missing=%@ unexpected=%@",arch,[wanted objectsPassingTest:^BOOL(id x,BOOL*stop){return ![found containsObject:x];}],[found objectsPassingTest:^BOOL(id x,BOOL*stop){return ![wanted containsObject:x];}]]);
  counts[arch]=@(found.count);
 }
 NSData*out=[NSJSONSerialization dataWithJSONObject:@{@"verified":@YES,@"libraries":counts} options:0 error:NULL];fwrite(out.bytes,1,out.length,stdout);fputc('\n',stdout);return 0;
 }@catch(NSException*e){fprintf(stderr,"Mavericks shared cache verification: %s\n",e.reason.UTF8String);return 70;}}}
