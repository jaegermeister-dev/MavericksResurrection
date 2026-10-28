/* The experiment copies only Mavericks' existing 11,2 AGPM board profile.
 * It does not spoof SMBIOS, inject a framebuffer or change Intel driver code. */
- (NSDictionary *)readRecord:(NSString *)relative optional:(BOOL)optional {
    NSString *p=[self path:relative absent:optional];if(!gmStat(p,optional).st_ino)return nil;gmPlain(p,NO);
    NSData *d=[NSData dataWithContentsOfFile:p];id r=d&&d.length<=65536?[NSJSONSerialization JSONObjectWithData:d options:0 error:NULL]:nil;
    if(![r isKindOfClass:[NSDictionary class]])gmFail(@"Invalid graphics experiment record.");return r;
}
- (NSDictionary *)repairInputs {
    NSDictionary *v=[NSDictionary dictionaryWithContentsOfFile:[self path:@"System/Library/CoreServices/SystemVersion.plist" absent:NO]];
    return @{@"version":v[@"ProductVersion"],@"build":v[@"ProductBuildVersion"],@"kernelSHA256":gmHashFile([self path:@"mach_kernel" absent:NO]),@"toolSHA256":gmHashFile([self path:@"usr/sbin/kextcache" absent:NO]),@"systemVersionSHA256":gmHashFile([self path:@"System/Library/CoreServices/SystemVersion.plist" absent:NO])};
}
- (NSDictionary *)baseline {gmFail(@"Graphics originals are retained in the per-installation experiment record.");}
- (NSDictionary *)managedState {
    NSDictionary *a=[self readRecord:gmSlots()[2] optional:YES];
    if(a&&(![a[@"schema"]isEqual:@1]||![a[@"volumeUUID"]isEqual:volumeID]||!gmUUID(a[@"transaction"])||![gmChoices()containsObject:a[@"selection"]]||!a[@"originalProfile"]))gmFail(@"Invalid graphics state.");
    return a?:@{@"status":@"disabled",@"selection":@"original"};
}
- (NSMutableDictionary *)graphicsPlist {
    NSString *path=[self path:gmSlots()[0] absent:NO];gmPlain(path,NO);NSData *d=[NSData dataWithContentsOfFile:path];
    if(!d||d.length>4*1024*1024)gmFail(@"AGPM Info.plist is unavailable or too large.");
    NSMutableDictionary *p=[NSPropertyListSerialization propertyListWithData:d options:NSPropertyListMutableContainersAndLeaves format:NULL error:NULL];
    if(![p isKindOfClass:[NSMutableDictionary class]]||![p[@"CFBundleIdentifier"]isEqual:@"com.apple.driver.AGPM"]||![p[@"IOKitPersonalities"][@"AGPM"][@"Machines"]isKindOfClass:[NSMutableDictionary class]])gmFail(@"Unexpected Mavericks AGPM configuration.");return p;
}
- (NSDictionary *)assessment:(NSString *)selection {
    if(![gmChoices()containsObject:selection])gmFail(@"Unknown graphics choice.");
    NSMutableDictionary *p=[self graphicsPlist];NSDictionary *machines=p[@"IOKitPersonalities"][@"AGPM"][@"Machines"],*donor=machines[@"Mac-3CBD00234E554E41"];
    if(![donor isKindOfClass:[NSDictionary class]]||donor.count!=1||![donor[@"IGPU"]isKindOfClass:[NSDictionary class]])gmFail(@"The stock MacBookPro11,2 IGPU profile was not found. No profile was guessed.");
    NSDictionary *state=[self managedState];BOOL enabled=[state[@"selection"]isEqual:@"native-112"];
    if(enabled&&![machines[@"Mac-06F11FD93F0323C5"]isEqual:state[@"appliedProfile"]])gmFail(@"The experimental board profile was changed outside this app. Collect diagnostics before changing it again.");
    return @{@"selection":selection,@"enabled":@(enabled),@"alreadySelected":@([state[@"selection"]isEqual:selection]),@"changedIndices":@[@0],@"components":@[gmSlots()[0]],@"pending":[self pending]?:[NSNull null]};
}
- (NSDictionary *)ownedChange:(NSString *)transaction {
    NSDictionary *p=[self pending];if(!gmUUID(transaction)||![p[@"id"]isEqual:transaction]||![p[@"owner"]isEqual:gmProcess(getppid())]||![p[@"repairInputs"]isEqual:[self repairInputs]])gmFail(@"This worker does not own the graphics transaction.");return p;
}
- (NSDictionary *)apply:(NSString *)transaction payload:(NSString *)payload {
    if(![payload isEqual:@"-"])gmFail(@"External graphics payloads are not accepted.");
    NSDictionary *pending=[self ownedChange:transaction],*before=[self verify:pending[@"snapshot"]];
    for(NSUInteger i=0;i<gmSlots().count;i++)if(![before[@"slots"][i][@"entries"]isEqual:gmTree([self path:gmSlots()[i] absent:YES],rootStat.st_dev)])gmFail(@"The installation changed before the graphics experiment.");
    [self assessment:pending[@"candidate"]];
    NSMutableDictionary *plist=[self graphicsPlist],*machines=plist[@"IOKitPersonalities"][@"AGPM"][@"Machines"];
    NSDictionary *state=[self managedState];BOOL enable=[pending[@"candidate"]isEqual:@"native-112"];
    id original=[state[@"selection"]isEqual:@"native-112"]?state[@"originalProfile"]:(machines[@"Mac-06F11FD93F0323C5"]?:[NSNull null]);
    id selected=enable?machines[@"Mac-3CBD00234E554E41"]:original;
    if(selected==[NSNull null])[machines removeObjectForKey:@"Mac-06F11FD93F0323C5"];else machines[@"Mac-06F11FD93F0323C5"]=selected;
    NSData *data=[NSPropertyListSerialization dataWithPropertyList:plist format:NSPropertyListXMLFormat_v1_0 options:0 error:NULL];if(!data)gmFail(@"Cannot encode the graphics profile.");
    [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Changes"]];NSString *work=[store stringByAppendingFormat:@"/Changes/%@",transaction];
    if(mkdir(work.fileSystemRepresentation,0700))gmFail(@"Graphics change already started; recover it first.");
    NSString *dest=[self path:gmSlots()[0] absent:NO],*copy=[work stringByAppendingPathComponent:@"slot-0"];
    gmCopy(dest,copy,rootStat.st_dev,[NSMutableDictionary dictionary]);
    int fd=open(copy.fileSystemRepresentation,O_WRONLY|O_TRUNC|O_NOFOLLOW);if(fd<0)gmFail(@"Cannot prepare the graphics profile.");
    const char *bytes=data.bytes;NSUInteger left=data.length;
    while(left){ssize_t n=write(fd,bytes,left);if(n<0&&errno==EINTR)continue;if(n<=0){close(fd);gmFail(@"Cannot write graphics profile.");}bytes+=n;left-=n;}
    if(fsync(fd)){close(fd);gmFail(@"Cannot flush graphics profile.");}close(fd);gmSync(copy,NO);
    if(![[NSDictionary dictionaryWithContentsOfFile:copy]isEqual:plist])gmFail(@"Graphics profile readback differs.");
    NSDictionary *applied=@{@"transaction":transaction,@"selection":pending[@"candidate"],@"originalProfile":original,@"appliedProfile":selected,@"sha256":gmHashFile(copy)};
    gmWriteJSON([work stringByAppendingPathComponent:@"Prepared.json"],applied);[self ownedChange:transaction];
    if(rename(dest.fileSystemRepresentation,[work stringByAppendingPathComponent:@"displaced-0"].fileSystemRepresentation)||rename(copy.fileSystemRepresentation,dest.fileSystemRepresentation))gmFail(@"Graphics change interrupted; recover the retained snapshot.");
    gmSync(dest.stringByDeletingLastPathComponent,YES);gmSync(work,YES);
    if(![gmHashFile(dest)isEqual:applied[@"sha256"]])gmFail(@"Installed profile differs.");
    gmWriteJSON([work stringByAppendingPathComponent:@"Applied.json"],applied);
    return @{@"applied":@YES,@"transaction":transaction};
}
- (NSDictionary *)commit:(NSString *)transaction receipt:(NSDictionary *)receipt {
    NSDictionary *p=[self ownedChange:transaction],*applied=[self readRecord:[gmStoreRelative stringByAppendingFormat:@"/Changes/%@/Applied.json",transaction] optional:NO];
    if(![applied[@"transaction"]isEqual:transaction]||![gmHashFile([self path:gmSlots()[0] absent:NO])isEqual:applied[@"sha256"]])gmFail(@"Graphics change is incomplete.");
    if(![receipt[@"kind"]isEqual:@"mavericks-post-update-caches"]||![receipt[@"completed"]isEqual:@YES]||![receipt[@"model"]isEqual:@"MacBookPro11,4"]||![receipt[@"kernelSHA256"]isEqual:p[@"repairInputs"][@"kernelSHA256"]]||![receipt[@"toolSHA256"]isEqual:p[@"repairInputs"][@"toolSHA256"]]||![receipt[@"version"]isEqual:p[@"repairInputs"][@"version"]]||![receipt[@"build"]isEqual:p[@"repairInputs"][@"build"]])gmFail(@"Graphics cache receipt does not match Mavericks.");
    NSDictionary *before=[self verify:p[@"snapshot"]];NSString *old=nil;
    for(NSDictionary *e in before[@"slots"][1][@"entries"])if([e[@"path"]isEqual:@"Startup/kernelcache"])old=e[@"sha256"];
    if(!old||![old isEqual:receipt[@"previousCacheSHA256"]])gmFail(@"The cache was not rebuilt from its saved state.");
    if(![gmHashFile([self path:@"System/Library/Caches/com.apple.kext.caches/Startup/kernelcache" absent:NO])isEqual:receipt[@"kernelcacheSHA256"]])gmFail(@"Rebuilt graphics cache differs.");
    NSArray *infos=@[@"System/Library/Caches/com.apple.kext.caches/Startup/IOKitPersonalities_x86_64.ioplist.gz",@"System/Library/Caches/com.apple.kext.caches/Startup/KextPropertyValues_OSBundleHelper_x86_64.plist.gz"];
    if([receipt[@"informationCaches"]count]!=2)gmFail(@"Missing information cache verification.");
    for(NSString *f in infos)if(![gmHashFile([self path:f absent:NO])isEqual:receipt[@"informationCaches"][f]])gmFail(@"Information cache differs.");
    for(NSUInteger i=0;i<2;i++){NSString *base=[self path:gmSlots()[i] absent:NO];for(NSDictionary *row in [gmTree(base,rootStat.st_dev)reverseObjectEnumerator])if(![row[@"kind"]isEqual:@"symlink"])gmSync([row[@"path"]length]?[base stringByAppendingPathComponent:row[@"path"]]:base,[row[@"kind"]isEqual:@"directory"]);}
    NSDictionary *active=@{@"schema":@1,@"status":@"committed",@"volumeUUID":volumeID,@"transaction":transaction,@"snapshot":p[@"snapshot"],@"selection":p[@"candidate"],@"originalProfile":applied[@"originalProfile"],@"appliedProfile":applied[@"appliedProfile"],@"cacheReceipt":receipt};
    gmWriteJSON([self path:gmSlots()[2] absent:YES],active);[self managedState];
    [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Journal"]];NSString *archive=[store stringByAppendingFormat:@"/Journal/%@-committed.json",transaction];
    if(gmStat(archive,YES).st_ino)gmFail(@"Recover the unfinished graphics commit first.");gmWriteJSON(archive,active);
    if(unlink([store stringByAppendingPathComponent:@"pending.json"].fileSystemRepresentation))gmFail(@"Recover the unfinished graphics commit first.");gmSync(store,YES);return active;
}
