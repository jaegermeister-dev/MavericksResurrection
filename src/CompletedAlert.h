#import <AppKit/AppKit.h>
@interface MRCompletedAlert : NSAlert
@end
@implementation MRCompletedAlert
- (NSModalResponse)runModal {
    NSWindow *completedWindow = [self window];
    [completedWindow setReleasedWhenClosed:NO];
    @try { return [super runModal]; }
    @finally {
        [completedWindow orderOut:nil];
        [completedWindow close];
        [[NSApplication sharedApplication] updateWindows];
    }
}
@end
