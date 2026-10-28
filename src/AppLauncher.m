/* Native application entry. Host JXA directly so the app owns one AppKit event
 * loop, rather than nesting it inside an AppleScript applet's event dispatcher.
 * All installation choices still go through Main.js and its native dialogs. */
#import <AppKit/AppKit.h>
#import <OSAKit/OSAKit.h>
#include <string.h>
#import "CompletedAlert.h"
#import "GeometryCompatibility.h"

static int Failed(NSString *detail) {
    NSApplication *application=[NSApplication sharedApplication];
    [application setActivationPolicy:NSApplicationActivationPolicyRegular];
    [application activateIgnoringOtherApps:YES];
    NSAlert *alert=[[MRCompletedAlert alloc] init];
    alert.messageText=@"MavericksResurrection could not start";
    alert.informativeText=detail ?: @"The application's script runtime was unavailable.";
    [alert addButtonWithTitle:@"Quit"];
    [alert runModal];
    [alert release];
    return 1;
}

int main(int argc,const char *argv[]) {
    @autoreleasepool {
        if ([NSProcessInfo processInfo].operatingSystemVersion.majorVersion < 12)
            return Failed(@"MavericksResurrection requires macOS Monterey 12 or later.");
        if(argc!=1 && !(argc==2 && strncmp(argv[1],"-psn_",5)==0))
            return Failed(@"Open MavericksResurrection normally without command-line installation arguments.");
        NSString *resources=[[NSBundle mainBundle] resourcePath];
        NSString *entry=[resources stringByAppendingPathComponent:@"src/Main.js"];
        NSError *readError=nil;
        NSString *source=[NSString stringWithContentsOfFile:entry encoding:NSUTF8StringEncoding error:&readError];
        if(!source)return Failed(readError.localizedDescription);
        OSALanguage *language=[OSALanguage languageForName:@"JavaScript"];
        if(!language)return Failed(@"JavaScript for Automation is unavailable. MavericksResurrection requires macOS Monterey 12 or later.");
        NSApplication *application=[NSApplication sharedApplication];
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application finishLaunching];
        OSAScript *script=[[OSAScript alloc] initWithSource:source language:language];
        NSDictionary *error=nil;
        [script executeAndReturnError:&error];
        [script release];
        if(error)return Failed([error description]);
        return 0;
    }
}
