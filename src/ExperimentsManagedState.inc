/* Three independent, reversible experiments; the cache is rebuilt once for the
 * complete selected configuration. Original files remain in verified snapshots. */
- (NSDictionary *)readRecord:(NSString *)relative optional:(BOOL)optional {
    NSString *p=[self path:relative absent:optional];if(!gmStat(p,optional).st_ino)return nil;gmPlain(p,NO);
    NSData *d=[NSData dataWithContentsOfFile:p];id r=d&&d.length<=65536?[NSJSONSerialization JSONObjectWithData:d options:0 error:NULL]:nil;
    if(![r isKindOfClass:[NSDictionary class]])gmFail(@"Invalid experimental settings record.");return r;
}
- (id)fileHash:(NSString *)relative {
    NSString *p=[self path:relative absent:YES];return gmStat(p,YES).st_ino?(id)gmHashFile(p):(id)[NSNull null];
}
- (NSDictionary *)repairInputs {
    NSDictionary *v=[NSDictionary dictionaryWithContentsOfFile:[self path:@"System/Library/CoreServices/SystemVersion.plist" absent:NO]];
    return @{@"version":v[@"ProductVersion"],@"build":v[@"ProductBuildVersion"],@"kernelSHA256":gmHashFile([self path:@"mach_kernel" absent:NO]),@"toolSHA256":gmHashFile([self path:@"usr/sbin/kextcache" absent:NO]),@"systemVersionSHA256":gmHashFile([self path:@"System/Library/CoreServices/SystemVersion.plist" absent:NO])};
}
- (NSDictionary *)baseline {gmFail(@"Original experiment files are retained in verified snapshots on this installation.");}
- (NSDictionary *)managedState {
    NSDictionary *a=[self readRecord:gmSlots()[4] optional:YES];
    if(a&&(![a[@"schema"]isEqual:@1]||![a[@"volumeUUID"]isEqual:volumeID]||!gmUUID(a[@"transaction"])||![gmChoices()containsObject:a[@"selection"]]||![a[@"originals"]isKindOfClass:[NSDictionary class]]||![a[@"appliedHashes"]isKindOfClass:[NSDictionary class]]))gmFail(@"Invalid saved experimental configuration.");
    return a?:@{@"status":@"disabled",@"selection":@"000",@"originals":@{},@"appliedHashes":@{}};
}
- (NSMutableDictionary *)agpmPlist {
    NSString *p=[self path:gmSlots()[0] absent:NO];gmPlain(p,NO);NSData *d=[NSData dataWithContentsOfFile:p];
    if(!d||d.length>4*1024*1024)gmFail(@"AGPM configuration is unavailable or too large.");
    NSMutableDictionary *v=[NSPropertyListSerialization propertyListWithData:d options:NSPropertyListMutableContainersAndLeaves format:NULL error:NULL];
    if(![v isKindOfClass:[NSMutableDictionary class]]||![v[@"CFBundleIdentifier"]isEqual:@"com.apple.driver.AGPM"]||![v[@"IOKitPersonalities"][@"AGPM"][@"Machines"]isKindOfClass:[NSMutableDictionary class]])gmFail(@"Unexpected Mavericks AGPM configuration.");
    NSDictionary *donor=v[@"IOKitPersonalities"][@"AGPM"][@"Machines"][@"Mac-3CBD00234E554E41"];
    if(![donor isKindOfClass:[NSDictionary class]]||donor.count!=1||![donor[@"IGPU"]isKindOfClass:[NSDictionary class]])gmFail(@"The original MacBookPro11,2 Intel graphics power profile was not found.");return v;
}
- (NSData *)enabledData:(NSUInteger)i {
    if(i==0){NSMutableDictionary *p=[self agpmPlist];NSMutableDictionary *m=p[@"IOKitPersonalities"][@"AGPM"][@"Machines"];m[@"Mac-06F11FD93F0323C5"]=m[@"Mac-3CBD00234E554E41"];return [NSPropertyListSerialization dataWithPropertyList:p format:NSPropertyListXMLFormat_v1_0 options:0 error:NULL];}
    if(i==1){
        NSString *p=[self path:gmSlots()[1] absent:NO];gmPlain(p,NO);NSMutableData *data=[NSMutableData dataWithContentsOfFile:p];
        if(data.length!=585776||![gmHashData(data)isEqual:@"e9353f0646e93d733952325f1283985fc829978b54c644482739e65b56b583c4"])gmFail(@"This Intel framebuffer version is not supported by the experiment. No binary was changed.");
        unsigned char *b=data.mutableBytes;const unsigned char expected[]={0x07,0x00,0x26,0x0d};
        if(memcmp(b+0x64d00,expected,4))gmFail(@"The original Iris Pro framebuffer entry differs.");
        b[0x64d00]=0x0e;return data;
    }
    NSString *donor=[self path:@"System/Library/Extensions/IOPlatformPluginFamily.kext/Contents/PlugIns/X86PlatformPlugin.kext/Contents/Resources/Mac-3CBD00234E554E41.plist" absent:NO];gmPlain(donor,NO);
    NSData *d=[NSData dataWithContentsOfFile:donor];
    if(d.length!=19972||![gmHashData(d)isEqual:@"13709ec5c51ff21527005877c0e366bb1af8c4abd35dab5dc449558a84bd5d13"])gmFail(@"The original Mavericks CPU power profile differs. No profile was guessed.");
    return d;
}
- (NSDictionary *)assessment:(NSString *)selection {
    if(![gmChoices()containsObject:selection])gmFail(@"Unknown experimental configuration.");
    NSDictionary *state=[self managedState];NSString *current=state[@"selection"];NSMutableArray *changed=[NSMutableArray array],*components=[NSMutableArray array],*enabled=[NSMutableArray array];
    for(NSUInteger i=0;i<3;i++){
        NSString *key=gmExperimentIDs()[i];BOOL was=[current characterAtIndex:i]=='1',want=[selection characterAtIndex:i]=='1';
        if(was){
            if(!gmUUID(state[@"originals"][key])||![state[@"appliedHashes"][key]isKindOfClass:[NSString class]]||![[self fileHash:gmSlots()[i]]isEqual:state[@"appliedHashes"][key]])gmFail([NSString stringWithFormat:@"The saved %@ experiment no longer matches this installation. Collect diagnostics before changing it; no configuration was guessed.",key]);
            [enabled addObject:key];
        }
        if(was!=want){[changed addObject:@(i)];[components addObject:gmSlots()[i]];if(want)(void)[self enabledData:i];else (void)[self verify:state[@"originals"][key]];}
    }
    return @{@"selection":selection,@"currentSelection":current,@"enabled":enabled,@"alreadySelected":@([current isEqual:selection]),@"changedIndices":changed,@"components":components,@"pending":[self pending]?:[NSNull null],@"volumeUUID":volumeID};
}
- (NSDictionary *)ownedChange:(NSString *)transaction {
    NSDictionary *p=[self pending];if(!gmUUID(transaction)||![p[@"id"]isEqual:transaction]||![p[@"owner"]isEqual:gmProcess(getppid())]||![p[@"repairInputs"]isEqual:[self repairInputs]])gmFail(@"This worker does not own the experiment transaction.");return p;
}
- (NSDictionary *)apply:(NSString *)transaction payload:(NSString *)payload {
    if(![payload isEqual:@"-"])gmFail(@"External experiment payloads are not accepted.");
    NSDictionary *pending=[self ownedChange:transaction],*before=[self verify:pending[@"snapshot"]];
    for(NSUInteger i=0;i<gmSlots().count;i++)if(![before[@"slots"][i][@"entries"]isEqual:gmTree([self path:gmSlots()[i] absent:YES],rootStat.st_dev)])gmFail(@"The installation changed before applying experimental settings.");
    NSDictionary *assessment=[self assessment:pending[@"candidate"]],*state=[self managedState];NSString *selection=pending[@"candidate"];
    NSMutableDictionary *originals=[state[@"originals"]mutableCopy],*hashes=[state[@"appliedHashes"]mutableCopy];
    NSMutableArray *order=[NSMutableArray array];
    // Remove old selections first. Prepare every replacement before changing any target file.
    for(unsigned pass=0;pass<2;pass++)for(NSNumber *n in assessment[@"changedIndices"])if(([selection characterAtIndex:n.unsignedIntegerValue]=='1')==(pass==1))[order addObject:n];
    [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Changes"]];NSString *work=[store stringByAppendingFormat:@"/Changes/%@",transaction];
    if(mkdir(work.fileSystemRepresentation,0700))gmFail(@"This experiment change already started; recover it first.");
    NSMutableArray *operations=[NSMutableArray array];
    for(NSNumber *number in order){
        NSUInteger i=number.unsignedIntegerValue;NSString *key=gmExperimentIDs()[i],*dest=[self path:gmSlots()[i] absent:YES],*copy=[work stringByAppendingFormat:@"/slot-%lu",(unsigned long)i];BOOL enable=[selection characterAtIndex:i]=='1';
        BOOL exists=NO;
        if(enable){
            NSData *data=[self enabledData:i];if(!data)gmFail(@"Cannot prepare the selected experiment.");
            if(gmStat(dest,YES).st_ino)gmCopy(dest,copy,rootStat.st_dev,[NSMutableDictionary dictionary]);
            else{int fd=open(copy.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0644);if(fd<0)gmFail(@"Cannot prepare a new board profile.");if(fchown(fd,0,0)||fchmod(fd,0644)){close(fd);gmFail(@"Cannot set the new board profile's required root:wheel ownership and permissions.");}close(fd);}
            int fd=open(copy.fileSystemRepresentation,O_WRONLY|O_TRUNC|O_NOFOLLOW);if(fd<0)gmFail(@"Cannot write the prepared experiment.");
            const char *b=data.bytes;NSUInteger left=data.length;while(left){ssize_t n=write(fd,b,left);if(n<0&&errno==EINTR)continue;if(n<=0){close(fd);gmFail(@"Cannot write experimental data.");}b+=n;left-=n;}
            if(fsync(fd)){close(fd);gmFail(@"Cannot flush experimental data.");}close(fd);gmSync(copy,NO);
            if(![gmHashFile(copy)isEqual:gmHashData(data)])gmFail(@"Prepared experiment readback differs.");originals[key]=pending[@"snapshot"];hashes[key]=gmHashFile(copy);exists=YES;
        }else{
            NSString *identifier=originals[key];NSDictionary *saved=[self verify:identifier];NSArray *entries=saved[@"slots"][i][@"entries"];
            if(entries.count){gmCopy([[self folder:identifier]stringByAppendingFormat:@"/slot-%lu",(unsigned long)i],copy,rootStat.st_dev,[NSMutableDictionary dictionary]);if(![entries isEqual:gmTree(copy,rootStat.st_dev)])gmFail(@"Original experiment file did not restore exactly.");exists=YES;}
            [originals removeObjectForKey:key];[hashes removeObjectForKey:key];
        }
        [operations addObject:@{@"index":number,@"enabled":@(enable),@"sha256":exists?(id)gmHashFile(copy):(id)[NSNull null]}];
    }
    NSDictionary *applied=@{@"transaction":transaction,@"selection":selection,@"originals":originals,@"appliedHashes":hashes,@"operations":operations};
    gmWriteJSON([work stringByAppendingPathComponent:@"Prepared.json"],applied);[self ownedChange:transaction];
    for(NSDictionary *op in operations){NSUInteger i=[op[@"index"]unsignedIntegerValue];NSString *dest=[self path:gmSlots()[i] absent:YES],*copy=[work stringByAppendingFormat:@"/slot-%lu",(unsigned long)i];
        if(gmStat(dest,YES).st_ino&&rename(dest.fileSystemRepresentation,[work stringByAppendingFormat:@"/displaced-%lu",(unsigned long)i].fileSystemRepresentation))gmFail(@"Could not retain the previous experiment file.");
        if(op[@"sha256"]!=[NSNull null]&&rename(copy.fileSystemRepresentation,dest.fileSystemRepresentation))gmFail(@"Experimental change interrupted; recover its saved state.");
        gmSync(dest.stringByDeletingLastPathComponent,YES);gmSync(work,YES);
        if(![[self fileHash:gmSlots()[i]]isEqual:op[@"sha256"]])gmFail(@"Applied experiment differs from its prepared file.");
    }
    gmWriteJSON([work stringByAppendingPathComponent:@"Applied.json"],applied);return @{@"applied":@YES,@"transaction":transaction};
}
- (NSDictionary *)commit:(NSString *)transaction receipt:(NSDictionary *)receipt {
    NSDictionary *p=[self ownedChange:transaction],*applied=[self readRecord:[gmStoreRelative stringByAppendingFormat:@"/Changes/%@/Applied.json",transaction] optional:NO];
    if(![applied[@"transaction"]isEqual:transaction]||![applied[@"selection"]isEqual:p[@"candidate"]])gmFail(@"The experiment change is incomplete.");
    for(NSDictionary *op in applied[@"operations"])if(![[self fileHash:gmSlots()[[op[@"index"]unsignedIntegerValue]]]isEqual:op[@"sha256"]])gmFail(@"An experimental file changed before commit.");
    if(![receipt[@"kind"]isEqual:@"mavericks-post-update-caches"]||![receipt[@"completed"]isEqual:@YES]||![receipt[@"model"]isEqual:@"MacBookPro11,4"]||![receipt[@"kernelSHA256"]isEqual:p[@"repairInputs"][@"kernelSHA256"]]||![receipt[@"toolSHA256"]isEqual:p[@"repairInputs"][@"toolSHA256"]]||![receipt[@"version"]isEqual:p[@"repairInputs"][@"version"]]||![receipt[@"build"]isEqual:p[@"repairInputs"][@"build"]])gmFail(@"The experimental cache receipt does not match Mavericks.");
    NSDictionary *before=[self verify:p[@"snapshot"]];NSString *old=nil;
    for(NSDictionary *e in before[@"slots"][3][@"entries"])if([e[@"path"]isEqual:@"Startup/kernelcache"])old=e[@"sha256"];
    if(!old||![old isEqual:receipt[@"previousCacheSHA256"]])gmFail(@"The cache was not rebuilt from its saved state.");
    if(![gmHashFile([self path:@"System/Library/Caches/com.apple.kext.caches/Startup/kernelcache" absent:NO])isEqual:receipt[@"kernelcacheSHA256"]])gmFail(@"Rebuilt experiment cache differs.");
    NSArray *infos=@[@"System/Library/Caches/com.apple.kext.caches/Startup/IOKitPersonalities_x86_64.ioplist.gz",@"System/Library/Caches/com.apple.kext.caches/Startup/KextPropertyValues_OSBundleHelper_x86_64.plist.gz"];
    if([receipt[@"informationCaches"]count]!=2)gmFail(@"Information cache verification is missing.");
    for(NSString *f in infos)if(![gmHashFile([self path:f absent:NO])isEqual:receipt[@"informationCaches"][f]])gmFail(@"Information cache differs.");
    for(NSUInteger i=0;i<4;i++){NSString *base=[self path:gmSlots()[i] absent:YES];for(NSDictionary *row in [gmTree(base,rootStat.st_dev)reverseObjectEnumerator])if(![row[@"kind"]isEqual:@"symlink"])gmSync([row[@"path"]length]?[base stringByAppendingPathComponent:row[@"path"]]:base,[row[@"kind"]isEqual:@"directory"]);}
    NSDictionary *active=@{@"schema":@1,@"status":@"committed",@"volumeUUID":volumeID,@"transaction":transaction,@"snapshot":p[@"snapshot"],@"selection":p[@"candidate"],@"originals":applied[@"originals"],@"appliedHashes":applied[@"appliedHashes"],@"cacheReceipt":receipt};
    gmWriteJSON([self path:gmSlots()[4] absent:YES],active);[self assessment:p[@"candidate"]];
    [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Journal"]];NSString *archive=[store stringByAppendingFormat:@"/Journal/%@-committed.json",transaction];
    if(gmStat(archive,YES).st_ino)gmFail(@"Recover the unfinished experiment commit first.");gmWriteJSON(archive,active);
    if(unlink([store stringByAppendingPathComponent:@"pending.json"].fileSystemRepresentation))gmFail(@"Recover the unfinished experiment commit first.");gmSync(store,YES);return active;
}
