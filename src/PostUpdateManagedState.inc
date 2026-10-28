/* Restores only changed, compiled model components. Updates to the operating
 * system, kernel and other drivers remain in place. Every replacement and cache
 * write is covered by the common durable snapshot/rollback engine. */
- (NSDictionary *)readModelRecord:(NSString *)relative optional:(BOOL)optional {
    NSString *p=[self path:relative absent:optional];if(!gmStat(p,optional).st_ino)return nil;gmPlain(p,NO);
    NSData *d=[NSData dataWithContentsOfFile:p];id r=d&&d.length<=65536?[NSJSONSerialization JSONObjectWithData:d options:0 error:NULL]:nil;
    if(![r isKindOfClass:[NSDictionary class]])gmFail(@"The post-update repair record is invalid.");return r;
}
- (NSUInteger)modelCount:(NSString *)model {
    if([model isEqual:@"MacBookPro11,4"])return 11;
    if([model isEqual:@"MacBookPro11,5"])return 16;
    gmFail(@"Post-update compatibility repair is only available for MacBookPro11,4 and MacBookPro11,5.");
}
- (BOOL)matchesComponent:(NSDictionary *)component at:(NSString *)path installed:(BOOL)installed {
    NSArray *actual=gmTree(path,gmStat(root,NO).st_dev),*expected=component[@"entries"];
    if(actual.count!=expected.count)return NO;
    NSMutableDictionary *rows=[NSMutableDictionary dictionary];for(NSDictionary *a in actual)rows[a[@"path"]]=a;
    for(NSDictionary *e in expected){NSDictionary *a=rows[e[@"path"]];
        NSArray *keys=[e[@"kind"]isEqual:@"file"]?@[@"kind",@"bytes",@"sha256"]:[e[@"kind"]isEqual:@"symlink"]?@[@"kind",@"link"]:@[@"kind"];
        for(NSString *key in keys)if(![e[key]isEqual:a[key]])return NO;
        if(a[@"hardlinkTo"]||[a[@"flags"]unsignedLongLongValue])return NO;
        if(installed)for(NSString *key in @[@"mode",@"uid",@"gid"])if(![e[key]isEqual:a[key]])return NO;
    }return YES;
}
- (void)verifyModelComponent:(NSDictionary *)component at:(NSString *)path installed:(BOOL)installed {
    // Payload staging can be on a different filesystem from the selected volume.
    NSArray *actual=gmTree(path,gmStat(path,NO).st_dev),*expected=component[@"entries"];
    if(actual.count!=expected.count)gmFail(@"A released component has missing or extra files.");
    NSMutableDictionary *rows=[NSMutableDictionary dictionary];for(NSDictionary *a in actual)rows[a[@"path"]]=a;
    for(NSDictionary *e in expected){NSDictionary *a=rows[e[@"path"]];
        NSArray *keys=[e[@"kind"]isEqual:@"file"]?@[@"kind",@"bytes",@"sha256"]:[e[@"kind"]isEqual:@"symlink"]?@[@"kind",@"link"]:@[@"kind"];
        for(NSString *key in keys)if(![e[key]isEqual:a[key]])gmFail(@"A repair component differs from its compiled inventory.");
        if(a[@"hardlinkTo"]||[a[@"flags"]unsignedLongLongValue])gmFail(@"Unexpected component hardlinks or flags.");
        if(installed)for(NSString *key in @[@"mode",@"uid",@"gid"])if(![e[key]isEqual:a[key]])gmFail(@"Installed repair component permissions differ.");
    }
}
- (NSDictionary *)repairInputs {
    NSDictionary *v=[NSDictionary dictionaryWithContentsOfFile:[self path:@"System/Library/CoreServices/SystemVersion.plist" absent:NO]];
    return @{@"version":v[@"ProductVersion"],@"build":v[@"ProductBuildVersion"],
        @"kernelSHA256":gmHashFile([self path:@"mach_kernel" absent:NO]),
        @"toolSHA256":gmHashFile([self path:@"usr/sbin/kextcache" absent:NO]),
        @"systemVersionSHA256":gmHashFile([self path:@"System/Library/CoreServices/SystemVersion.plist" absent:NO])};
}
- (NSDictionary *)baseline {gmFail(@"Each post-update repair retains its own complete driver and cache snapshot.");}
- (NSDictionary *)managedState {
    NSDictionary *active=[self readModelRecord:gmSlots()[17] optional:YES];
    if(active&&(![active[@"schema"]isEqual:@1]||![active[@"volumeUUID"]isEqual:volumeID]||!gmUUID(active[@"transaction"])||![gmChoices()containsObject:active[@"model"]]))gmFail(@"Invalid post-update repair completion record.");
    return active?:@{@"status":@"not-repaired"};
}
- (NSDictionary *)assessment:(NSString *)model {
    NSUInteger count=[self modelCount:model];NSMutableArray *changed=[NSMutableArray array],*names=[NSMutableArray array];
    for(NSUInteger i=0;i<count;i++)if(![self matchesComponent:gmModelPayload()[@"components"][i] at:[self path:gmSlots()[i] absent:YES] installed:YES]){[changed addObject:@(i)];[names addObject:gmSlots()[i]];}
    NSDictionary *active=[self managedState],*cache=active[@"cacheReceipt"];BOOL ready=NO;
    if(!changed.count&&[active[@"model"]isEqual:model]&&[active[@"repairInputs"]isEqual:[self repairInputs]]&&[cache[@"completed"]isEqual:@YES]){
        ready=[gmHashFile([self path:@"System/Library/Caches/com.apple.kext.caches/Startup/kernelcache" absent:NO])isEqual:cache[@"kernelcacheSHA256"]];
        for(NSString *file in @[@"System/Library/Caches/com.apple.kext.caches/Startup/IOKitPersonalities_x86_64.ioplist.gz",@"System/Library/Caches/com.apple.kext.caches/Startup/KextPropertyValues_OSBundleHelper_x86_64.plist.gz"]){NSString *p=[self path:file absent:YES];if(!gmStat(p,YES).st_ino||![gmHashFile(p)isEqual:cache[@"informationCaches"][file]])ready=NO;}
    }
    return @{@"model":model,@"changedIndices":changed,@"components":names,@"repairNeeded":ready?@NO:@YES,@"alreadyRepaired":ready?@YES:@NO,@"pending":[self pending]?:[NSNull null]};
}
- (NSDictionary *)ownedModelChange:(NSString *)transaction {
    NSDictionary *p=[self pending];if(!gmUUID(transaction)||![p[@"id"]isEqual:transaction]||![p[@"owner"]isEqual:gmProcess(getppid())])gmFail(@"This worker does not own the post-update repair.");
    NSUInteger count=[self modelCount:p[@"candidate"]];NSArray *changed=p[@"changedIndices"];
    if(![changed isKindOfClass:[NSArray class]]||![p[@"repairInputs"]isEqual:[self repairInputs]])gmFail(@"The Mavericks kernel, tool or system version changed during repair.");
    NSMutableSet *seen=[NSMutableSet set];for(NSNumber *n in changed){if(![n isKindOfClass:[NSNumber class]]||n.integerValue<0||n.unsignedIntegerValue>=count||[seen containsObject:n])gmFail(@"Invalid repair component selection.");[seen addObject:n];}return p;
}
- (NSDictionary *)apply:(NSString *)transaction payload:(NSString *)payload {
    NSDictionary *p=[self ownedModelChange:transaction],*before=[self verify:p[@"snapshot"]];NSArray *changed=p[@"changedIndices"];
    if(![payload hasPrefix:@"/"]||![payload isEqual:[[payload stringByStandardizingPath]stringByResolvingSymlinksInPath]])gmFail(@"Invalid repair payload location.");gmPlain(payload,YES);
    for(NSUInteger i=0;i<gmSlots().count;i++)if(![before[@"slots"][i][@"entries"]isEqual:gmTree([self path:gmSlots()[i] absent:YES],rootStat.st_dev)])gmFail(@"The selected installation changed before repair.");
    [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Changes"]];NSString *work=[store stringByAppendingFormat:@"/Changes/%@",transaction];
    if(mkdir(work.fileSystemRepresentation,0700))gmFail(@"Repair already started; recover it first.");
    for(NSNumber *index in changed){NSUInteger i=index.unsignedIntegerValue;NSDictionary *component=gmModelPayload()[@"components"][i];NSString *source=payload;
        NSArray *parts=[component[@"source"]componentsSeparatedByString:@"/"];
        for(NSUInteger n=0;n<parts.count;n++){source=[source stringByAppendingPathComponent:parts[n]];struct stat s=gmStat(source,NO);if(S_ISLNK(s.st_mode)||(n+1<parts.count&&!S_ISDIR(s.st_mode)))gmFail(@"Linked repair payload ancestor.");}
        [self verifyModelComponent:component at:source installed:NO];NSString *copy=[work stringByAppendingFormat:@"/slot-%lu",(unsigned long)i];gmCopy(source,copy,gmStat(source,NO).st_dev,[NSMutableDictionary dictionary]);
        for(NSDictionary *entry in component[@"entries"]){NSString *item=[entry[@"path"]length]?[copy stringByAppendingPathComponent:entry[@"path"]]:copy;if(lchown(item.fileSystemRepresentation,0,0))gmFail(@"Cannot set repair ownership.");if(![entry[@"kind"]isEqual:@"symlink"]&&chmod(item.fileSystemRepresentation,[entry[@"mode"]unsignedIntValue]))gmFail(@"Cannot set repair permissions.");}
        [self verifyModelComponent:component at:copy installed:YES];
    }
    gmWriteJSON([work stringByAppendingPathComponent:@"Prepared.json"],p);[self ownedModelChange:transaction];
    for(NSNumber *index in changed){NSUInteger i=index.unsignedIntegerValue;NSString *dest=[self path:gmSlots()[i] absent:YES],*copy=[work stringByAppendingFormat:@"/slot-%lu",(unsigned long)i],*old=[work stringByAppendingFormat:@"/displaced-%lu",(unsigned long)i];
        if(gmStat(dest,YES).st_ino&&rename(dest.fileSystemRepresentation,old.fileSystemRepresentation))gmFail(@"Cannot retain the preceding compatibility component.");
        if(rename(copy.fileSystemRepresentation,dest.fileSystemRepresentation))gmFail(@"Repair was interrupted; recovery data is retained.");gmSync(dest.stringByDeletingLastPathComponent,YES);gmSync(work,YES);
        [self verifyModelComponent:gmModelPayload()[@"components"][i] at:dest installed:YES];
    }
    gmWriteJSON([work stringByAppendingPathComponent:@"Applied.json"],p);return @{@"applied":@YES,@"transaction":transaction,@"model":p[@"candidate"],@"components":@(changed.count)};
}
- (NSDictionary *)commit:(NSString *)transaction receipt:(NSDictionary *)receipt {
    NSDictionary *p=[self ownedModelChange:transaction];NSUInteger count=[self modelCount:p[@"candidate"]];
    if(![[self readModelRecord:[gmStoreRelative stringByAppendingFormat:@"/Changes/%@/Applied.json",transaction] optional:NO]isEqual:p])gmFail(@"Component repair is incomplete.");
    if(![receipt isKindOfClass:[NSDictionary class]]||![receipt[@"kind"]isEqual:@"mavericks-post-update-caches"]||![receipt[@"completed"]isEqual:@YES]||![receipt[@"model"]isEqual:p[@"candidate"]]||![receipt[@"version"]isEqual:p[@"repairInputs"][@"version"]]||![receipt[@"build"]isEqual:p[@"repairInputs"][@"build"]]||![receipt[@"kernelSHA256"]isEqual:p[@"repairInputs"][@"kernelSHA256"]]||![receipt[@"toolSHA256"]isEqual:p[@"repairInputs"][@"toolSHA256"]]||[receipt[@"bundleCount"]unsignedIntegerValue]<1||[receipt[@"bundleCount"]unsignedIntegerValue]>4096)gmFail(@"The repair cache receipt differs from the current Mavericks system.");
    NSDictionary *before=[self verify:p[@"snapshot"]];NSString *oldCacheHash=nil;
    for(NSDictionary *entry in before[@"slots"][16][@"entries"])if([entry[@"path"]isEqual:@"Startup/kernelcache"])oldCacheHash=entry[@"sha256"];
    if(!oldCacheHash||![oldCacheHash isEqual:receipt[@"previousCacheSHA256"]])gmFail(@"The repair did not use the snapshotted boot cache.");
    for(NSUInteger i=0;i<count;i++)[self verifyModelComponent:gmModelPayload()[@"components"][i] at:[self path:gmSlots()[i] absent:NO] installed:YES];
    for(NSUInteger i=0;i<16;i++)if(![p[@"changedIndices"]containsObject:@(i)]&&![before[@"slots"][i][@"entries"]isEqual:gmTree([self path:gmSlots()[i] absent:YES],rootStat.st_dev)])gmFail(@"An unselected compatibility component changed.");
    if(![gmHashFile([self path:@"System/Library/Caches/com.apple.kext.caches/Startup/kernelcache" absent:NO])isEqual:receipt[@"kernelcacheSHA256"]])gmFail(@"The rebuilt boot cache changed.");
    NSArray *infos=@[@"System/Library/Caches/com.apple.kext.caches/Startup/IOKitPersonalities_x86_64.ioplist.gz",@"System/Library/Caches/com.apple.kext.caches/Startup/KextPropertyValues_OSBundleHelper_x86_64.plist.gz"];
    if([receipt[@"informationCaches"]count]!=2)gmFail(@"Missing repaired information-cache receipt.");for(NSString *file in infos)if(![gmHashFile([self path:file absent:NO])isEqual:receipt[@"informationCaches"][file]])gmFail(@"A repaired information cache changed.");
    NSDictionary *active=@{@"schema":@1,@"status":@"committed",@"transaction":transaction,@"volumeUUID":volumeID,@"snapshot":p[@"snapshot"],@"model":p[@"candidate"],@"changedIndices":p[@"changedIndices"],@"repairInputs":p[@"repairInputs"],@"cacheReceipt":receipt};
    NSMutableArray *flush=[NSMutableArray arrayWithArray:p[@"changedIndices"]];[flush addObject:@16];
    for(NSNumber *index in flush){NSString *base=[self path:gmSlots()[index.unsignedIntegerValue] absent:YES];for(NSDictionary *row in [gmTree(base,rootStat.st_dev)reverseObjectEnumerator])if(![row[@"kind"]isEqual:@"symlink"]){NSString *full=[row[@"path"]length]?[base stringByAppendingPathComponent:row[@"path"]]:base;gmSync(full,[row[@"kind"]isEqual:@"directory"]);}}
    gmWriteJSON([self path:gmSlots()[17] absent:YES],active);[self managedState];
    [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Journal"]];NSString *archive=[store stringByAppendingFormat:@"/Journal/%@-committed.json",transaction];
    if(gmStat(archive,YES).st_ino)gmFail(@"The preceding repair commit did not retire cleanly; recover first.");gmWriteJSON(archive,@{@"schema":@1,@"status":@"committed",@"transaction":p,@"active":active});
    if(unlink([store stringByAppendingPathComponent:@"pending.json"].fileSystemRepresentation))gmFail(@"Repair was recorded but requires recovery before continuing.");gmSync(store,YES);return active;
}
