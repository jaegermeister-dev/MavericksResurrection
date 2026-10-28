/* Compare complete TreeManifest files one record at a time. This avoids keeping
 * a roughly 130 MB / 400,000-entry installed-system inventory in the GUI heap.
 * Source and copied filesystem scans must already be complete. --copy-list only
 * writes a new path-list file; no filesystem trees are modified by this helper. */
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <math.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

static BOOL excludeFilesystemState=NO;

static void fail(NSString *why) { @throw [NSException exceptionWithName:@"ManifestVerification" reason:why userInfo:nil]; }
static BOOL number(id value, double low, double high) {
    if (![value isKindOfClass:[NSNumber class]] || CFGetTypeID((CFTypeRef)value)==CFBooleanGetTypeID()) return NO;
    double n=[value doubleValue];return isfinite(n) && floor(n)==n && n>=low && n<=high;
}
static BOOL text(id value) { return [value isKindOfClass:[NSString class]]; }
static BOOL path(id value) {
    if (!text(value) || [value rangeOfCharacterFromSet:[NSCharacterSet characterSetWithRange:NSMakeRange(0,1)]].location!=NSNotFound) return NO;
    if (![value length]) return YES;
    for(NSString *part in [value componentsSeparatedByString:@"/"]) if (!part.length || [part isEqual:@"."] || [part isEqual:@".."]) return NO;
    return YES;
}
static BOOL hash(id value) {
    if (!text(value) || [value length]!=64) return NO;
    return [value rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet]].location==NSNotFound;
}
static BOOL stable(const struct stat *a,const struct stat *b) {
    return a->st_dev==b->st_dev && a->st_ino==b->st_ino && a->st_size==b->st_size && a->st_nlink==b->st_nlink &&
        a->st_mode==b->st_mode && a->st_uid==b->st_uid && a->st_gid==b->st_gid &&
        a->st_mtimespec.tv_sec==b->st_mtimespec.tv_sec && a->st_mtimespec.tv_nsec==b->st_mtimespec.tv_nsec &&
        a->st_ctimespec.tv_sec==b->st_ctimespec.tv_sec && a->st_ctimespec.tv_nsec==b->st_ctimespec.tv_nsec;
}
static NSString *digest(CC_SHA256_CTX *ctx) {
    unsigned char raw[CC_SHA256_DIGEST_LENGTH];char out[65];CC_SHA256_Final(raw,ctx);
    for(unsigned i=0;i<sizeof raw;i++)sprintf(out+i*2,"%02x",raw[i]);return [NSString stringWithUTF8String:out];
}
static BOOL filesystemMetadata(NSString *p) {
    for(NSString *root in @[@".fseventsd",@".Spotlight-V100",@".Trashes",@".TemporaryItems"])
        if([p isEqual:root] || [p hasPrefix:[root stringByAppendingString:@"/"]]) return YES;
    return NO;
}

@interface ManifestReader : NSObject {
    FILE *stream; char *buffer; size_t capacity; struct stat opened;
    NSString *filePath; NSMutableDictionary *seen,*links; CC_SHA256_CTX checksum;
    unsigned long long rawCount,rawBytes,keptCount,keptBytes; BOOL complete,ended;
    NSString *fileSHA;
}
- (id)initWithPath:(NSString *)p;
- (NSDictionary *)next;
- (NSString *)sha;
- (unsigned long long)entries;
- (unsigned long long)bytes;
@end
@implementation ManifestReader
- (id)initWithPath:(NSString *)p {
    if((self=[super init])) {
        int fd=open([p fileSystemRepresentation],O_RDONLY|O_NOFOLLOW);
        if(fd<0)fail(@"Cannot open a manifest.");
        if(fstat(fd,&opened) || !S_ISREG(opened.st_mode)) {close(fd);fail(@"A manifest must be a regular file.");}
        stream=fdopen(fd,"r");if(!stream){close(fd);fail(@"Cannot read a manifest.");}
        filePath=[p copy];seen=[[NSMutableDictionary alloc]init];links=[[NSMutableDictionary alloc]init];CC_SHA256_Init(&checksum);
    }return self;
}
- (void)dealloc {if(stream)fclose(stream);free(buffer);[filePath release];[seen release];[links release];[fileSHA release];[super dealloc];}
- (void)validate:(NSDictionary *)r {
    NSString *p=r[@"path"],*kind=r[@"kind"];
    if(![r[@"type"] isEqual:@"entry"] || !path(p) || seen[p] || (!rawCount && (![p isEqual:@""] || ![kind isEqual:@"directory"])) ||
        ![@[@"file",@"directory",@"symlink"] containsObject:kind] || !number(r[@"mode"],0,4095) ||
        !number(r[@"uid"],0,4294967295.0) || !number(r[@"gid"],0,4294967295.0) || !number(r[@"flags"],0,4294967295.0) ||
        !number(r[@"mtimeSeconds"],-9007199254740991.0,9007199254740991.0) || !number(r[@"mtimeNanoseconds"],0,999999999) ||
        !text(r[@"acl"]) || ![r[@"xattrs"] isKindOfClass:[NSArray class]])fail(@"Invalid filesystem record.");
    if(rawCount) {
        NSRange slash=[p rangeOfString:@"/" options:NSBackwardsSearch];NSString *parent=slash.location==NSNotFound?@"":[p substringToIndex:slash.location];
        if(![seen[parent] isEqual:@"directory"])fail(@"A filesystem record has no preceding directory parent.");
    }
    NSMutableSet *names=[NSMutableSet set];
    for(id a in r[@"xattrs"]) {
        if(![a isKindOfClass:[NSDictionary class]] || !text(a[@"name"]) || ![a[@"name"] length] ||
            [names containsObject:a[@"name"]] || !number(a[@"bytes"],0,9007199254740991.0) || !hash(a[@"sha256"]))fail(@"Invalid extended attribute record.");
        [names addObject:a[@"name"]];
    }
    if([kind isEqual:@"file"]) {
        if(!number(r[@"bytes"],0,9007199254740991.0) || !hash(r[@"sha256"]) || r[@"link"])fail(@"Invalid regular-file identity.");
        rawBytes+=[r[@"bytes"] unsignedLongLongValue];if(rawBytes>9007199254740991ULL)fail(@"Manifest byte count overflow.");
        if(r[@"hardlinkTo"]) {
            NSString *first=r[@"hardlinkTo"];if(!path(first))fail(@"Invalid hardlink path.");
            if([first isEqual:p])links[p]=@{@"bytes":r[@"bytes"],@"sha256":r[@"sha256"]};
            else if(!links[first] || ![links[first][@"bytes"] isEqual:r[@"bytes"]] || ![links[first][@"sha256"] isEqual:r[@"sha256"]])fail(@"Hardlink identity differs.");
        }
    } else {
        if(r[@"bytes"] || r[@"sha256"] || r[@"hardlinkTo"])fail(@"Invalid non-file record.");
        if([kind isEqual:@"symlink"]) {
            if(!text(r[@"link"]) || ![r[@"link"] length] || [r[@"link"] rangeOfCharacterFromSet:[NSCharacterSet characterSetWithRange:NSMakeRange(0,1)]].location!=NSNotFound)fail(@"Invalid symbolic link.");
        } else if(r[@"link"])fail(@"Invalid directory link field.");
    }
    seen[p]=kind;rawCount++;
}
- (NSDictionary *)next {
    if(ended)return nil;
    while(1) {
        ssize_t count=getline(&buffer,&capacity,stream);
        if(count<0) {
            if(ferror(stream) || !complete)fail(@"Incomplete filesystem manifest.");
            struct stat after,named;
            if(fstat(fileno(stream),&after) || lstat([filePath fileSystemRepresentation],&named) || !stable(&opened,&after) || !stable(&after,&named))fail(@"The manifest changed while being read.");
            fileSHA=[digest(&checksum) copy];ended=YES;return nil;
        }
        if(count>16*1024*1024 || buffer[count-1]!='\n')fail(@"Invalid or oversized manifest line.");
        CC_SHA256_Update(&checksum,buffer,(CC_LONG)count);
        if(complete)fail(@"Unexpected data after manifest completion.");
        NSData *data=[NSData dataWithBytes:buffer length:(NSUInteger)count];
        NSDictionary *row=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
        if(![row isKindOfClass:[NSDictionary class]])fail(@"Invalid manifest JSON.");
        if([row[@"type"] isEqual:@"complete"]) {
            if(!rawCount || !number(row[@"schema"],1,1) || !number(row[@"entries"],1,9007199254740991.0) ||
                !number(row[@"logicalFileBytes"],0,9007199254740991.0) || [row[@"entries"] unsignedLongLongValue]!=rawCount ||
                [row[@"logicalFileBytes"] unsignedLongLongValue]!=rawBytes)fail(@"Manifest completion counts differ.");
            complete=YES;continue;
        }
        [self validate:row];
        if(excludeFilesystemState && filesystemMetadata(row[@"path"]))continue;
        keptCount++;if([row[@"kind"] isEqual:@"file"])keptBytes+=[row[@"bytes"] unsignedLongLongValue];
        return row;
    }
}
- (NSString *)sha {if(!ended)fail(@"Manifest is not fully consumed.");return fileSHA;}
- (unsigned long long)entries {return keptCount;}
- (unsigned long long)bytes {return keptBytes;}
@end
static NSDictionary *comparable(NSDictionary *row) {
    NSMutableDictionary *r=[[row mutableCopy] autorelease];
    if([r[@"kind"] isEqual:@"symlink"]) {[r removeObjectForKey:@"mtimeSeconds"];[r removeObjectForKey:@"mtimeNanoseconds"];}
    r[@"xattrs"]=[r[@"xattrs"] sortedArrayUsingComparator:^NSComparisonResult(id a,id b){return[a[@"name"] compare:b[@"name"]];}];
    return r;
}
static NSDictionary *inspect(NSString *selectionPath,NSString *manifestPath) {
    NSData *data=[NSData dataWithContentsOfFile:selectionPath];
    NSDictionary *selection=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL]:nil;
    if(![selection isKindOfClass:[NSDictionary class]] || !number(selection[@"schema"],1,1) ||
        ![selection[@"prefixes"] isKindOfClass:[NSArray class]] || ![selection[@"prefixes"] count] ||
        [selection[@"prefixes"] count]>256)fail(@"Invalid manifest inspection selection.");
    NSMutableSet *unique=[NSMutableSet set];
    for(id prefix in selection[@"prefixes"]) {
        if(!path(prefix) || ![prefix length] || [unique containsObject:prefix])fail(@"Invalid inspection prefix.");
        [unique addObject:prefix];
    }
    ManifestReader *reader=[[[ManifestReader alloc]initWithPath:manifestPath]autorelease];
    NSMutableArray *selected=[NSMutableArray array];BOOL done=NO;
    while(!done) {@autoreleasepool {
        NSDictionary *row=[reader next];
        if(!row){done=YES;continue;}
        NSString *p=row[@"path"];
        for(NSString *prefix in selection[@"prefixes"]) {
            if([p isEqual:prefix] || [p hasPrefix:[prefix stringByAppendingString:@"/"]]) {
                if(selected.count>=50000)fail(@"Inspection selection is too large.");
                [selected addObject:row];break;
            }
        }
    }}
    return @{@"validated":@YES,@"entries":@([reader entries]),@"logicalFileBytes":@([reader bytes]),
        @"manifestSHA256":[reader sha],@"records":selected};
}
static NSDictionary *copyList(NSString *manifestPath,NSString *outputPath) {
    int fd=open(outputPath.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    if(fd<0)fail(@"Cannot create a new copy list.");
    FILE *output=fdopen(fd,"w");if(!output){close(fd);fail(@"Cannot open copy list output.");}
    @try {
        excludeFilesystemState=YES;
        ManifestReader *reader=[[[ManifestReader alloc]initWithPath:manifestPath]autorelease];BOOL done=NO;
        NSMutableArray *literalSidecars=[NSMutableArray array];
        while(!done){@autoreleasepool{
            NSDictionary *row=[reader next];if(!row){done=YES;continue;}
            NSString *p=row[@"path"];
            // Unicode format marks occur in Apple's original Arabic MakePDF
            // filename. They are ordinary UTF-8 name bytes, not line separators.
            NSMutableCharacterSet *lineControls=[NSMutableCharacterSet characterSetWithRange:NSMakeRange(0,32)];
            [lineControls addCharactersInRange:NSMakeRange(127,1)];
            if([p rangeOfCharacterFromSet:lineControls].location!=NSNotFound)fail(@"A system path cannot be represented in a BOM list.");
            // ditto treats AppleDouble names specially and can omit these
            // original BaseSystem files. Preserve their literal contents too.
            if([row[@"kind"] isEqual:@"file"] && [[p lastPathComponent] hasPrefix:@"._"]) {
                if(literalSidecars.count>=1024)fail(@"Too many literal metadata sidecars.");
                [literalSidecars addObject:p];
            }
            NSString *line=p.length?[@"./" stringByAppendingString:p]:@".";
            if(fprintf(output,"%s\n",line.UTF8String)<0)fail(@"Cannot write copy list.");
        }}
        if(fflush(output) || fsync(fd))fail(@"Cannot save copy list.");
        return @{@"validated":@YES,@"entries":@([reader entries]),@"logicalFileBytes":@([reader bytes]),@"manifestSHA256":[reader sha],
            @"excludedFilesystemMetadata":@[@".fseventsd",@".Spotlight-V100",@".Trashes",@".TemporaryItems"],@"literalSidecars":literalSidecars};
    }@finally{fclose(output);}
}
int main(int argc,char **argv) {
    @autoreleasepool {
        @try {
            if(argc!=4 || (strcmp(argv[1],"--all-files") && strcmp(argv[1],"--installed-system") && strcmp(argv[1],"--inspect") && strcmp(argv[1],"--copy-list")) || argv[2][0]!='/' || argv[3][0]!='/') {
                fprintf(stderr,"Usage: ManifestCompare --all-files|--installed-system /source.jsonl /copied.jsonl\n       ManifestCompare --inspect /selection.json /manifest.jsonl\n       ManifestCompare --copy-list /manifest.jsonl /new-list.txt\n");return 64;
            }
            NSDictionary *result;
            if(!strcmp(argv[1],"--copy-list")) {
                result=copyList([NSString stringWithUTF8String:argv[2]],[NSString stringWithUTF8String:argv[3]]);
            }else if(!strcmp(argv[1],"--inspect")) {
                result=inspect([NSString stringWithUTF8String:argv[2]],[NSString stringWithUTF8String:argv[3]]);
            }else{
            excludeFilesystemState=!strcmp(argv[1],"--installed-system");
            ManifestReader *a=[[[ManifestReader alloc]initWithPath:[NSString stringWithUTF8String:argv[2]]]autorelease];
            ManifestReader *b=[[[ManifestReader alloc]initWithPath:[NSString stringWithUTF8String:argv[3]]]autorelease];
            BOOL done=NO;
            while(!done) {@autoreleasepool {
                NSDictionary *left=[a next],*right=[b next];
                if(!left || !right) {if(left || right)fail(@"Copied filesystem member count differs.");done=YES;}
                else if(![comparable(left) isEqual:comparable(right)])fail([@"Copied filesystem content or metadata differs: " stringByAppendingString:left[@"path"]]);
            }}
            result=@{@"matched":@YES,@"entries":@([a entries]),@"logicalFileBytes":@([a bytes]),
                @"sourceManifestSHA256":[a sha],@"copiedManifestSHA256":[b sha],
                @"excludedFilesystemMetadata":excludeFilesystemState?@[@".fseventsd",@".Spotlight-V100",@".Trashes",@".TemporaryItems"]:@[],
                @"timestampException":@"Symlink modification times only; link destinations and other metadata are checked."};
            }
            NSData *out=[NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
            if(!out || fwrite(out.bytes,1,out.length,stdout)!=out.length || fputc('\n',stdout)==EOF || fflush(stdout))fail(@"Cannot write comparison result.");
            return 0;
        } @catch(NSException *error) {fprintf(stderr,"%s\n",[error.reason UTF8String]);return 1;}
    }
}
