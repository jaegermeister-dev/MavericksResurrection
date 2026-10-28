/* Final metadata/receipt bookkeeping for a fresh, bound offline 13F34 volume.
 * Expected package ACL records were independently matched between both native
 * installer captures. Each record is checked against the actual live ACL
 * before recording it. No copied keys, caches, dates or host preferences. */
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <sys/mount.h>
#include <sys/acl.h>
#include <sandbox.h>
#include <fcntl.h>
#include <unistd.h>
#include <limits.h>
#include <stdlib.h>
#include <stdio.h>
#include <errno.h>
static NSString *root;
static dev_t device;
static void fail(NSString*s){@throw [NSException exceptionWithName:@"MavericksFidelity" reason:s userInfo:nil];}
static NSString *path(NSString*relative,BOOL missing){
 if(![relative isKindOfClass:[NSString class]]||!relative.length||[relative hasPrefix:@"/"]||[relative rangeOfCharacterFromSet:[NSCharacterSet controlCharacterSet]].location!=NSNotFound)fail(@"Invalid relative path");
 NSArray*parts=[relative componentsSeparatedByString:@"/"];NSString*p=root;
 for(NSUInteger i=0;i<parts.count;i++){
  NSString*c=parts[i];if(!c.length||[c isEqual:@"."]||[c isEqual:@".."])fail(@"Invalid relative component");
  p=[p stringByAppendingPathComponent:c];struct stat s;
  if(lstat(p.fileSystemRepresentation,&s)){if(missing&&i==parts.count-1&&errno==ENOENT)return p;fail([@"Missing metadata path: " stringByAppendingString:relative]);}
  if(s.st_dev!=device||S_ISLNK(s.st_mode)||(i<parts.count-1&&!S_ISDIR(s.st_mode)))fail(@"Metadata path crosses a link or filesystem");
 }
 return p;
}
static NSString *hashFile(NSString*p){
 int fd=open(p.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW);if(fd<0)fail(@"Cannot hash package BOM");
 CC_SHA256_CTX c;CC_SHA256_Init(&c);unsigned char b[65536],h[32];ssize_t n;
 while((n=read(fd,b,sizeof b))>0)CC_SHA256_Update(&c,b,(CC_LONG)n);close(fd);if(n<0)fail(@"Cannot finish hashing BOM");
 CC_SHA256_Final(h,&c);char hex[65];for(int i=0;i<32;i++)sprintf(hex+2*i,"%02x",h[i]);return [NSString stringWithUTF8String:hex];
}
static void writePlist(NSString*relative,id value){
 NSString*p=path(relative,YES);NSData*d=[NSPropertyListSerialization dataWithPropertyList:value format:NSPropertyListBinaryFormat_v1_0 options:0 error:NULL];
 if(!d||![d writeToFile:p options:NSDataWritingAtomic error:NULL]||chown(p.fileSystemRepresentation,0,0)||chmod(p.fileSystemRepresentation,0644))fail(@"Cannot record native metadata");
 id back=[NSPropertyListSerialization propertyListWithData:[NSData dataWithContentsOfFile:p] options:0 format:NULL error:NULL];if(![back isEqual:value])fail(@"Metadata readback differs");
}
static void permissions(NSString*p,mode_t mode){if(chown(p.fileSystemRepresentation,0,0)||chmod(p.fileSystemRepresentation,mode))fail(@"Cannot set native folder ownership/permissions");}
static NSString *aclText(NSString*p){
 acl_t acl=acl_get_link_np(p.fileSystemRepresentation,ACL_TYPE_EXTENDED);if(!acl)fail([@"Cannot read ACL: " stringByAppendingString:p]);
 ssize_t count=0;char*t=acl_to_text(acl,&count);if(!t){acl_free(acl);fail(@"Cannot serialize ACL");}
 NSString*s=[NSString stringWithUTF8String:t];acl_free(t);acl_free(acl);if(!s)fail(@"Invalid ACL text");return s;
}
int main(int argc,char**argv){@autoreleasepool{@try{
 if(geteuid()||argc!=5)return 64;
 root=[NSString stringWithUTF8String:argv[1]];struct stat s,host;struct statfs fs;
 char *end=NULL;unsigned long long wantedDev=strtoull(argv[2],&end,10);if(!*argv[2]||*end)fail(@"Invalid device");unsigned long long wantedIno=strtoull(argv[3],&end,10);if(!*argv[3]||*end)fail(@"Invalid inode");
 if(![[root stringByResolvingSymlinksInPath] isEqual:root]||lstat(root.fileSystemRepresentation,&s)||stat("/",&host)||!S_ISDIR(s.st_mode)||s.st_dev==host.st_dev||statfs(root.fileSystemRepresentation,&fs)||strcmp(fs.f_fstypename,"hfs")||strcmp(fs.f_mntonname,root.fileSystemRepresentation)||(fs.f_flags&MNT_RDONLY)||(unsigned long long)s.st_dev!=wantedDev||(unsigned long long)s.st_ino!=wantedIno)fail(@"Offline filesystem identity differs");
 device=s.st_dev;
 NSDictionary*version=[NSDictionary dictionaryWithContentsOfFile:path(@"System/Library/CoreServices/SystemVersion.plist",NO)];
 if(![version[@"ProductVersion"] isEqual:@"10.9.5"]||![version[@"ProductBuildVersion"] isEqual:@"13F34"]||[[NSFileManager defaultManager] fileExistsAtPath:[root stringByAppendingPathComponent:@"private/var/db/.AppleSetupDone"]])fail(@"A fresh Mavericks 13F34 filesystem is required");
 NSData*data=[NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[4]]];
 NSDictionary*catalog=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL]:nil;
 if(![catalog[@"schema"] isEqual:@1]||![catalog[@"build"] isEqual:@"13F34"]||[catalog[@"packages"] count]!=12)fail(@"Native receipt catalog differs");
 NSString*escaped=[[root stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"] stringByReplacingOccurrencesOfString:@"\"" withString:@"\\\""];
 NSString*profile=[NSString stringWithFormat:@"(version 1)(allow default)(deny file-write*)(allow file-write* (subpath \"%@\"))(allow file-write-data (literal \"/dev/null\"))(deny network*)",escaped];char*error=NULL;
 if(sandbox_init(profile.UTF8String,0,&error))fail(@"Cannot confine metadata writes");
 NSMutableDictionary*acls=[NSMutableDictionary dictionary];NSMutableArray*receipts=[NSMutableArray array];NSUInteger recorded=0;
 // Validate the entire receipt/ACL plan before changing any receipt.
 for(NSDictionary*p in catalog[@"packages"]){
  NSString*identifier=p[@"identifier"];if(![identifier hasPrefix:@"com.apple.pkg."]||[identifier rangeOfString:@"/"].location!=NSNotFound)fail(@"Invalid receipt identifier");
  NSString*prefix=[@"private/var/db/receipts/" stringByAppendingString:identifier];
  if(![hashFile(path([prefix stringByAppendingString:@".bom"],NO)) isEqual:p[@"bomSHA256"]])fail(@"Package BOM differs from native reference");
  NSMutableDictionary*r=[[NSDictionary dictionaryWithContentsOfFile:path([prefix stringByAppendingString:@".plist"],NO)] mutableCopy];
  if(![r[@"PackageIdentifier"] isEqual:identifier]||![r[@"PackageVersion"] isEqual:p[@"version"]]||![r[@"InstallPrefixPath"] isEqual:@"/"])fail(@"Receipt identity differs");
  NSDictionary*expected=p[@"PathACLs"];
  for(NSString*rel in expected){
   if(!acls[rel])acls[rel]=aclText(path(rel,NO));
   if(![acls[rel] isEqual:expected[rel]])fail([@"Actual ACL differs from native receipt record: " stringByAppendingString:rel]);
  }
  if(expected.count)r[@"PathACLs"]=expected;else[r removeObjectForKey:@"PathACLs"];
  recorded+=expected.count;[receipts addObject:@{@"path":[prefix stringByAppendingString:@".plist"],@"value":r}];[r release];
 }
 for(NSDictionary*r in receipts)writePlist(r[@"path"],r[@"value"]);
 permissions(root,0755);permissions(path(@"Library/Keychains",NO),0755);
 writePlist(@"Library/Preferences/.GlobalPreferences.plist",@{@"AppleLanguages":@[@"en"]});
 writePlist(@"private/var/root/Library/Preferences/.GlobalPreferences.plist",@{@"AppleKeyboardUIMode":@3});
 permissions(path(@"private/var/root/Library/Preferences/.GlobalPreferences.plist",NO),0600);
 writePlist(@"private/var/db/.AppleInstallType.plist",@{@"InstallType":@"10"});
 NSDictionary*result=@{@"completed":@YES,@"packageReceipts":@(receipts.count),@"aclRecords":@(recorded),@"uniqueACLPaths":@(acls.count),@"rootMode":@"0755",@"rootOwner":@"0:0"};
 NSData*out=[NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];fwrite(out.bytes,1,out.length,stdout);fputc('\n',stdout);return 0;
 }@catch(NSException*e){fprintf(stderr,"Mavericks fidelity metadata: %s\n",e.reason.UTF8String);return 70;}}}
