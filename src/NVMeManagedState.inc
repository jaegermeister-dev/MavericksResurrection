/* Included inside GMNVMeSnapshotStore. Driver acceptance is compiled from the
 * shipped inventory; caller-supplied names or manifests cannot authorize removal.
 * Original Mavericks has neither managed slot. An initial app-installed candidate
 * is adopted only with its protected absence provenance and exact driver files. */
- (NSDictionary *)readControl:(NSString *)relative optional:(BOOL)optional {
    NSString *p=[self path:relative absent:optional];if(!gmStat(p,optional).st_ino)return nil;gmPlain(p,NO);
    NSData *d=[NSData dataWithContentsOfFile:p];if(!d||d.length>65536)gmFail(@"NVMe control record is missing or oversized.");
    NSDictionary *r=[NSJSONSerialization JSONObjectWithData:d options:0 error:NULL];if(![r isKindOfClass:[NSDictionary class]])gmFail(@"Invalid NVMe control record.");return r;
}
- (NSDictionary *)candidate:(NSString *)key {
    if([key isEqual:@"original"])return nil;
    for(NSDictionary *c in gmNVMeCandidates()[@"candidates"])if([c[@"id"]isEqual:key])return c;
    gmFail(@"Unknown compiled NVMe candidate.");
}
- (void)verifyDriver:(NSString *)path slot:(NSUInteger)slot device:(dev_t)device {
    NSArray *expected=gmNVMePayload()[@"components"][slot][@"entries"],*actual=gmTree(path,device);
    if(expected.count!=actual.count)gmFail(@"The NVMe driver has unknown or missing files; it was retained.");
    NSMutableDictionary *byPath=[NSMutableDictionary dictionary];for(NSDictionary *r in actual)byPath[r[@"path"]]=r;
    for(NSDictionary *e in expected){NSDictionary *a=byPath[e[@"path"]];
        for(NSString *key in @[@"kind",@"mode",@"uid",@"gid"])if(![e[key]isEqual:a[key]])gmFail(@"The NVMe driver type or permissions differ; it was retained.");
        if(a[@"hardlinkTo"]||[a[@"flags"]unsignedLongLongValue])gmFail(@"An NVMe driver has unexpected hardlinks or flags.");
        if([e[@"kind"]isEqual:@"file"]&&(![e[@"sha256"]isEqual:a[@"sha256"]]||![e[@"bytes"]isEqual:a[@"bytes"]]))gmFail(@"The NVMe driver was modified outside this app; it was retained.");
    }
}
- (void)verifyDrivers:(NSString *)key {
    NSDictionary *candidate=[self candidate:key];NSArray *drivers=candidate?candidate[@"drivers"]:@[];
    for(NSUInteger i=0;i<2;i++){
        BOOL selected=NO;for(NSDictionary *d in drivers)if([d[@"path"]isEqual:gmSlots()[i]])selected=YES;
        NSString *path=[self path:gmSlots()[i] absent:YES];
        if(selected)[self verifyDriver:path slot:i device:rootStat.st_dev];
        else if(gmStat(path,YES).st_ino)gmFail(@"An unrecognized NVMe driver occupies a managed location; it was retained.");
    }
}
- (NSArray *)absentBaseline {
    return @[@{@"path":gmSlots()[0],@"kind":@"absent"},@{@"path":gmSlots()[1],@"kind":@"absent"}];
}
- (BOOL)validOrigin:(id)value suffix:(NSString *)suffix {
    if(![value isKindOfClass:[NSString class]])return NO;
    NSString *current=[@"mavericksresurrection-" stringByAppendingString:suffix];
    NSString *creator=[[gmStoreRelative stringByDeletingLastPathComponent]lastPathComponent].lowercaseString;
    return [value isEqual:current]||[value isEqual:[[creator stringByAppendingString:@"-"]stringByAppendingString:suffix]];
}
- (NSDictionary *)initialState {
    NSDictionary *r=[self readControl:[gmStoreRelative stringByAppendingPathComponent:@"initial-state.json"] optional:YES];if(!r)return nil;
    NSDictionary *candidate=[self candidate:r[@"activeCandidate"]];
    if(!candidate||![r[@"schema"]isEqual:@1]||![self validOrigin:r[@"origin"] suffix:@"fresh-install"]||!gmUUID(r[@"installationID"])||![r[@"baseline"]isEqual:[self absentBaseline]]||![r[@"candidateRevision"]isEqual:candidate[@"revision"]]||![r[@"drivers"]isEqual:candidate[@"drivers"]]||!gmKnownInitialNVMeArchive(r[@"payloadArchiveSHA256"]))gmFail(@"The initial experimental-driver provenance is invalid.");
    return r;
}
- (NSDictionary *)baseline {
    NSString *relative=[gmStoreRelative stringByAppendingPathComponent:@"OriginalBaseline.json"];
    NSDictionary *r=[self readControl:relative optional:YES];
    if(r){
        if(![r[@"schema"]isEqual:@1]||!gmUUID(r[@"id"])||![r[@"volumeUUID"]isEqual:volumeID]||![r[@"slots"]isEqual:[self absentBaseline]]||![@[@"observed-absent",@"verified-fresh-install"]containsObject:r[@"origin"]])gmFail(@"The original NVMe baseline is invalid or belongs to another volume.");
        if([r[@"origin"]isEqual:@"verified-fresh-install"]){NSDictionary *initial=[self initialState];NSString *p=[self path:[gmStoreRelative stringByAppendingPathComponent:@"initial-state.json"] absent:NO];if(!initial||![initial[@"installationID"]isEqual:r[@"installationID"]]||![gmHashFile(p)isEqual:r[@"initialStateSHA256"]])gmFail(@"Initial NVMe provenance changed after baseline capture.");}
        return r;
    }
    if([self pending]||[self readControl:gmSlots()[3] optional:YES])gmFail(@"An existing NVMe transaction has no original baseline; no driver was changed.");
    NSDictionary *initial=[self initialState];[self verifyDrivers:initial?initial[@"activeCandidate"]:@"original"];
    NSMutableDictionary *created=[@{@"schema":@1,@"id":[NSUUID UUID].UUIDString,@"volumeUUID":volumeID,@"slots":[self absentBaseline],@"origin":initial?@"verified-fresh-install":@"observed-absent"}mutableCopy];
    if(initial){created[@"installationID"]=initial[@"installationID"];created[@"initialStateSHA256"]=gmHashFile([self path:[gmStoreRelative stringByAppendingPathComponent:@"initial-state.json"] absent:NO]);}
    gmWriteJSON([self path:relative absent:YES],created);[created release];return [self baseline];
}
- (NSDictionary *)managedState {
    NSDictionary *baseline=[self baseline],*active=[self readControl:gmSlots()[3] optional:YES];NSString *key;
    if(active){
        if(![active[@"schema"]isEqual:@1]||![self validOrigin:active[@"origin"] suffix:@"maintenance"]||![active[@"baselineID"]isEqual:baseline[@"id"]]||![active[@"volumeUUID"]isEqual:volumeID]||!gmUUID(active[@"transaction"]))gmFail(@"The active experimental-driver record is invalid.");
        key=active[@"candidate"];[self candidate:key];
    }else{NSDictionary *initial=[self initialState];key=initial?initial[@"activeCandidate"]:@"original";}
    [self verifyDrivers:key];NSDictionary *candidate=[self candidate:key];
    return @{@"candidate":key,@"revision":candidate?candidate[@"revision"]:@0,@"baselineID":baseline[@"id"],@"volumeUUID":volumeID};
}
- (NSDictionary *)ownedPending:(NSString *)transaction {
    NSDictionary *p=[self pending];if(!gmUUID(transaction)||!p||![p[@"id"]isEqual:transaction]||![p[@"owner"]isEqual:gmProcess(getppid())])gmFail(@"This worker does not own the pending NVMe change.");
    [self verify:p[@"snapshot"]];[self baseline];return p;
}
- (NSDictionary *)apply:(NSString *)transaction payload:(NSString *)payload {
    NSDictionary *p=[self ownedPending:transaction],*before=[self verify:p[@"snapshot"]];[self managedState];
    for(NSUInteger i=0;i<gmSlots().count;i++)if(![before[@"slots"][i][@"entries"]isEqual:gmTree([self path:gmSlots()[i] absent:YES],rootStat.st_dev)])gmFail(@"The previous state changed before driver replacement.");
    NSDictionary *candidate=[self candidate:p[@"candidate"]];
    if(candidate){if(![payload hasPrefix:@"/"]||![payload isEqual:[[payload stringByStandardizingPath]stringByResolvingSymlinksInPath]])gmFail(@"Invalid verified payload root.");gmPlain(payload,YES);}
    else if(![payload isEqual:@"-"])gmFail(@"Removal does not accept a payload path.");
    [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Changes"]];NSString *work=[store stringByAppendingFormat:@"/Changes/%@",transaction];
    if(mkdir(work.fileSystemRepresentation,0700))gmFail(@"A driver change was already started; recover it first.");
    NSMutableArray *selected=[NSMutableArray array];
    for(NSUInteger i=0;i<2;i++)for(NSDictionary *d in candidate[@"drivers"])if([d[@"path"]isEqual:gmSlots()[i]]){
        NSString *source=payload;for(NSString *part in [gmSlots()[i]componentsSeparatedByString:@"/"]){source=[source stringByAppendingPathComponent:part];gmPlain(source,YES);}
        dev_t device=gmStat(source,NO).st_dev;[self verifyDriver:source slot:i device:device];NSString *copy=[work stringByAppendingFormat:@"/slot-%lu",(unsigned long)i];
        gmCopy(source,copy,device,[NSMutableDictionary dictionary]);[self verifyDriver:copy slot:i device:rootStat.st_dev];[selected addObject:@(i)];
    }
    gmWriteJSON([work stringByAppendingPathComponent:@"Prepared.json"],p);[self ownedPending:transaction];[self managedState];
    for(NSUInteger i=0;i<2;i++){
        NSString *dest=[self path:gmSlots()[i] absent:YES],*displaced=[work stringByAppendingFormat:@"/displaced-%lu",(unsigned long)i];
        if(gmStat(dest,YES).st_ino&&rename(dest.fileSystemRepresentation,displaced.fileSystemRepresentation))gmFail(@"Cannot preserve the previous experimental driver.");
        gmSync(dest.stringByDeletingLastPathComponent,YES);gmSync(work,YES);
    }
    // Every prior driver is durably displaced before installing any replacement.
    // The unchanged pending transaction restores the complete prior state on failure.
    for(NSUInteger i=0;i<2;i++)if(gmStat([self path:gmSlots()[i] absent:YES],YES).st_ino)gmFail(@"Previous NVMe driver remains present; use recovery.");
    for(NSNumber *number in selected){
        NSUInteger i=number.unsignedIntegerValue;NSString *dest=[self path:gmSlots()[i] absent:YES];
        NSString *copy=[work stringByAppendingFormat:@"/slot-%lu",(unsigned long)i];
        if(rename(copy.fileSystemRepresentation,dest.fileSystemRepresentation))gmFail(@"Driver replacement interrupted; use recovery.");
        gmSync(dest.stringByDeletingLastPathComponent,YES);gmSync(work,YES);
    }
    [self verifyDrivers:p[@"candidate"]];gmWriteJSON([work stringByAppendingPathComponent:@"Applied.json"],p);
    return @{@"applied":@YES,@"transaction":transaction,@"candidate":p[@"candidate"]};
}
- (NSDictionary *)commit:(NSString *)transaction receipt:(NSDictionary *)receipt {
    NSDictionary *p=[self ownedPending:transaction],*baseline=[self baseline];
    NSString *applied=[gmStoreRelative stringByAppendingFormat:@"/Changes/%@/Applied.json",transaction];
    if(![[self readControl:applied optional:NO]isEqual:p])gmFail(@"Driver application has not completed for this transaction.");
    [self verifyDrivers:p[@"candidate"]];NSDictionary *version=[NSDictionary dictionaryWithContentsOfFile:[self path:@"System/Library/CoreServices/SystemVersion.plist" absent:NO]];
    if(![receipt isKindOfClass:[NSDictionary class]]||![receipt[@"kind"]isEqual:@"mavericks-maintenance-caches"]||![receipt[@"completed"]isEqual:@YES]||![receipt[@"version"]isEqual:version[@"ProductVersion"]]||![receipt[@"build"]isEqual:version[@"ProductBuildVersion"]]||![receipt[@"candidate"]isEqual:([p[@"candidate"]isEqual:@"original"]?[NSNull null]:p[@"candidate"])]||![receipt[@"bundleCount"]isKindOfClass:[NSNumber class]]||[receipt[@"bundleCount"]unsignedIntegerValue]<1)gmFail(@"The completed cache rebuild does not match this driver change.");
    NSDictionary *files=@{@"mach_kernel":receipt[@"kernelSHA256"]?:@"",@"usr/sbin/kextcache":receipt[@"toolSHA256"]?:@"",@"System/Library/Caches/com.apple.kext.caches/Startup/kernelcache":receipt[@"kernelcacheSHA256"]?:@""};
    for(NSString *relative in files){NSString *path=[self path:relative absent:NO];gmPlain(path,NO);if(![gmHashFile(path)isEqual:files[relative]])gmFail(@"The current kernel, cache tool or rebuilt boot cache changed before commit.");}
    NSDictionary *information=receipt[@"informationCaches"];
    NSArray *expected=@[@"System/Library/Caches/com.apple.kext.caches/Startup/IOKitPersonalities_x86_64.ioplist.gz",@"System/Library/Caches/com.apple.kext.caches/Startup/KextPropertyValues_OSBundleHelper_x86_64.plist.gz"];
    if(![information isKindOfClass:[NSDictionary class]]||information.count!=expected.count)gmFail(@"The information-cache receipt is incomplete.");
    for(NSString *relative in expected){NSString *path=[self path:relative absent:NO];gmPlain(path,NO);if(![gmHashFile(path)isEqual:information[relative]])gmFail(@"An information cache changed before commit.");}
    NSDictionary *before=[self verify:p[@"snapshot"]];NSString *oldHash=nil;for(NSDictionary *r in before[@"slots"][2][@"entries"])if([r[@"path"]isEqual:@"Startup/kernelcache"])oldHash=r[@"sha256"];
    if(!oldHash||![oldHash isEqual:receipt[@"previousCacheSHA256"]])gmFail(@"The rebuild did not use this transaction's previous cache.");
    NSString *cacheRoot=[self path:gmSlots()[2] absent:NO];NSArray *cacheTree=gmTree(cacheRoot,rootStat.st_dev);
    for(NSDictionary *row in [cacheTree reverseObjectEnumerator])if(![row[@"kind"]isEqual:@"symlink"]){NSString *path=[row[@"path"]length]?[cacheRoot stringByAppendingPathComponent:row[@"path"]]:cacheRoot;gmSync(path,[row[@"kind"]isEqual:@"directory"]);}
    gmSync(cacheRoot.stringByDeletingLastPathComponent,YES);
    [self makePrivate:[gmStoreRelative stringByAppendingPathComponent:@"Journal"]];NSString *archive=[store stringByAppendingFormat:@"/Journal/%@-committed.json",transaction];
    if(gmStat(archive,YES).st_ino)gmFail(@"A prior commit did not retire cleanly; recover this change first.");
    NSDictionary *active=@{@"schema":@1,@"origin":@"mavericksresurrection-maintenance",@"volumeUUID":volumeID,@"baselineID":baseline[@"id"],@"transaction":transaction,@"candidate":p[@"candidate"],@"cacheReceipt":receipt};
    gmWriteJSON([self path:gmSlots()[3] absent:YES],active);if(![[self readControl:gmSlots()[3] optional:NO]isEqual:active])gmFail(@"Active driver state failed readback.");
    [self managedState];[self ownedPending:transaction];gmWriteJSON(archive,@{@"schema":@1,@"status":@"committed",@"transaction":p,@"active":active});
    // A crash before this final durable retirement always restores the prior
    // snapshot on reopening, even if the new active-state record was written.
    if(unlink([store stringByAppendingPathComponent:@"pending.json"].fileSystemRepresentation))gmFail(@"Driver change recorded but journal retirement failed; recover before continuing.");gmSync(store,YES);
    return @{@"status":@"committed",@"transaction":transaction,@"candidate":p[@"candidate"],@"baselineID":baseline[@"id"]};
}
