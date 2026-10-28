/* Panel overrides are independent files: no driver or boot-cache changes.
 * Preserve the old file before an atomic replacement. A retry after power loss
 * can safely accept the exact installed profile or repeat the operation. */
- (NSDictionary *)displayAssessment {
    NSString *p=[self path:mrDisplayPath absent:YES];struct stat s=gmStat(p,YES);
    if(s.st_ino&&(!S_ISREG(s.st_mode)||s.st_nlink!=1||s.st_size>65536||s.st_flags))gmFail(@"Unexpected display profile file. No profile was replaced.");
    BOOL match=s.st_ino&&s.st_uid==0&&s.st_gid==0&&(s.st_mode&07777)==0644&&[gmHashFile(p)isEqual:mrDisplayHash];
    return @{@"path":mrDisplayPath,@"matches":@(match),@"sha256":mrDisplayHash};
}
- (NSDictionary *)applyDisplayProfile {
    [self guard];if([self pending])gmFail(@"Recover the unfinished compatibility repair before repairing display scaling.");
    NSDictionary *assessment=[self displayAssessment];
    if([assessment[@"matches"]boolValue])return @{@"verified":@YES,@"changed":@NO,@"path":mrDisplayPath,@"sha256":mrDisplayHash};
    NSData *data=[[[NSData alloc]initWithBase64EncodedString:mrDisplayData options:0]autorelease];
    if(!data||![gmHashData(data)isEqual:mrDisplayHash])gmFail(@"The bundled display profile differs.");
    NSString *dest=[self path:mrDisplayPath absent:YES];NSArray *before=gmTree(dest,rootStat.st_dev);
    NSString *relative=[gmStoreRelative stringByAppendingFormat:@"/DisplayProfiles/%@",[NSUUID UUID].UUIDString];
    [self makePrivate:relative];NSString *work=[self path:relative absent:NO];
    NSString *old=[work stringByAppendingPathComponent:@"original"],*copy=[work stringByAppendingPathComponent:@"replacement"];
    if(before.count){gmCopy(dest,old,rootStat.st_dev,[NSMutableDictionary dictionary]);if(![before isEqual:gmTree(old,rootStat.st_dev)])gmFail(@"Display profile backup verification failed.");}
    gmWriteJSON([work stringByAppendingPathComponent:@"before.json"],@{@"schema":@1,@"volumeUUID":volumeID,@"path":mrDisplayPath,@"entries":before});
    int fd=open(copy.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    if(fd<0)gmFail(@"Cannot prepare the display profile.");
    const char *bytes=data.bytes;NSUInteger left=data.length;
    while(left){ssize_t n=write(fd,bytes,left);if(n<0&&errno==EINTR)continue;if(n<=0){close(fd);gmFail(@"Cannot write the display profile.");}bytes+=n;left-=n;}
    if(fchown(fd,0,0)||fchmod(fd,0644)||fsync(fd)){close(fd);gmFail(@"Cannot protect or synchronize the display profile.");}close(fd);gmSync(copy,NO);
    if(![gmHashFile(copy)isEqual:mrDisplayHash])gmFail(@"Prepared display profile readback differs.");
    [self guard];dest=[self path:mrDisplayPath absent:YES];
    if(![before isEqual:gmTree(dest,rootStat.st_dev)])gmFail(@"The display profile changed during preparation.");
    BOOL replaced=NO;
    @try {
        if(rename(copy.fileSystemRepresentation,dest.fileSystemRepresentation))gmFail(@"Cannot install the display profile.");replaced=YES;
        gmSync(dest.stringByDeletingLastPathComponent,YES);gmSync(work,YES);
#ifdef MR_DISPLAY_TEST_FAIL_AFTER_RENAME
        gmFail(@"Injected display-profile readback failure.");
#endif
        if(![[self displayAssessment][@"matches"]boolValue])gmFail(@"Installed display profile verification failed.");
        gmWriteJSON([work stringByAppendingPathComponent:@"complete.json"],@{@"verified":@YES,@"sha256":mrDisplayHash});
    } @catch(NSException *failure) {
        if(replaced){
            [self guard];dest=[self path:mrDisplayPath absent:NO];
            if(![gmHashFile(dest)isEqual:mrDisplayHash])gmFail(@"The display profile changed externally; its original backup was retained.");
            if(before.count){NSString *restore=[work stringByAppendingPathComponent:@"restore"];gmCopy(old,restore,rootStat.st_dev,[NSMutableDictionary dictionary]);if(![before isEqual:gmTree(restore,rootStat.st_dev)]||rename(restore.fileSystemRepresentation,dest.fileSystemRepresentation))gmFail(@"Display profile recovery is incomplete; its original backup was retained.");}
            else if(unlink(dest.fileSystemRepresentation))gmFail(@"Cannot remove the failed display profile; its recovery record was retained.");
            gmSync(dest.stringByDeletingLastPathComponent,YES);
            if(![before isEqual:gmTree(dest,rootStat.st_dev)])gmFail(@"Display profile recovery verification failed.");
        }
        @throw failure;
    }
    return @{@"verified":@YES,@"changed":@YES,@"path":mrDisplayPath,@"sha256":mrDisplayHash,@"backup":relative};
}
