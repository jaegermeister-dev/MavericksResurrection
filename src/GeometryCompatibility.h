/* Keep AppKit geometry inside native code. Mojave/Catalina's JXA bridge
 * can abort while decoding nested NSRect/CGRect structures. These scalar
 * selectors perform exactly the same geometry operations without transporting
 * those structures through the bridge. */
#ifndef MR_GEOMETRY_COMPATIBILITY_H
#define MR_GEOMETRY_COMPATIBILITY_H
#import <AppKit/AppKit.h>
@interface NSView (MRGeometryCompatibility)
- (id)mrInitWithX:(CGFloat)x y:(CGFloat)y width:(CGFloat)w height:(CGFloat)h;
- (void)mrSetFrameWithX:(CGFloat)x y:(CGFloat)y width:(CGFloat)w height:(CGFloat)h;
- (void)mrSetFrameOriginWithX:(CGFloat)x y:(CGFloat)y;
- (void)mrSetFrameSizeWithWidth:(CGFloat)w height:(CGFloat)h;
- (CGFloat)mrBoundsWidth;
- (CGFloat)mrBoundsHeight;
@end
@implementation NSView (MRGeometryCompatibility)
- (id)mrInitWithX:(CGFloat)x y:(CGFloat)y width:(CGFloat)w height:(CGFloat)h { return [self initWithFrame:NSMakeRect(x,y,w,h)]; }
- (void)mrSetFrameWithX:(CGFloat)x y:(CGFloat)y width:(CGFloat)w height:(CGFloat)h { [self setFrame:NSMakeRect(x,y,w,h)]; }
- (void)mrSetFrameOriginWithX:(CGFloat)x y:(CGFloat)y { [self setFrameOrigin:NSMakePoint(x,y)]; }
- (void)mrSetFrameSizeWithWidth:(CGFloat)w height:(CGFloat)h { [self setFrameSize:NSMakeSize(w,h)]; }
- (CGFloat)mrBoundsWidth { return self.bounds.size.width; }
- (CGFloat)mrBoundsHeight { return self.bounds.size.height; }
@end
@interface NSPopUpButton (MRGeometryCompatibility)
- (id)mrInitWithX:(CGFloat)x y:(CGFloat)y width:(CGFloat)w height:(CGFloat)h pullsDown:(BOOL)pullsDown;
@end
@implementation NSPopUpButton (MRGeometryCompatibility)
- (id)mrInitWithX:(CGFloat)x y:(CGFloat)y width:(CGFloat)w height:(CGFloat)h pullsDown:(BOOL)pullsDown { return [self initWithFrame:NSMakeRect(x,y,w,h) pullsDown:pullsDown]; }
@end
@interface NSWindow (MRGeometryCompatibility)
- (id)mrInitWithX:(CGFloat)x y:(CGFloat)y width:(CGFloat)w height:(CGFloat)h styleMask:(NSWindowStyleMask)style backing:(NSBackingStoreType)backing defer:(BOOL)defer;
- (void)mrSetContentMinSizeWithWidth:(CGFloat)w height:(CGFloat)h;
- (void)mrSetContentSizeWithWidth:(CGFloat)w height:(CGFloat)h;
@end
@implementation NSWindow (MRGeometryCompatibility)
- (id)mrInitWithX:(CGFloat)x y:(CGFloat)y width:(CGFloat)w height:(CGFloat)h styleMask:(NSWindowStyleMask)style backing:(NSBackingStoreType)backing defer:(BOOL)defer { return [self initWithContentRect:NSMakeRect(x,y,w,h) styleMask:style backing:backing defer:defer]; }
- (void)mrSetContentMinSizeWithWidth:(CGFloat)w height:(CGFloat)h { [self setContentMinSize:NSMakeSize(w,h)]; }
- (void)mrSetContentSizeWithWidth:(CGFloat)w height:(CGFloat)h { [self setContentSize:NSMakeSize(w,h)]; }
@end
@interface NSTextContainer (MRGeometryCompatibility)
- (void)mrSetContainerSizeWithWidth:(CGFloat)w height:(CGFloat)h;
@end
@implementation NSTextContainer (MRGeometryCompatibility)
- (void)mrSetContainerSizeWithWidth:(CGFloat)w height:(CGFloat)h { [self setContainerSize:NSMakeSize(w,h)]; }
@end
@interface NSScreen (MRGeometryCompatibility)
- (CGFloat)mrVisibleWidth;
- (CGFloat)mrVisibleHeight;
@end
@implementation NSScreen (MRGeometryCompatibility)
- (CGFloat)mrVisibleWidth { return self.visibleFrame.size.width; }
- (CGFloat)mrVisibleHeight { return self.visibleFrame.size.height; }
@end
@interface MavericksResurrectionWindowCanvas : NSView
@end
@implementation MavericksResurrectionWindowCanvas
- (BOOL)isOpaque { return YES; }
- (void)drawRect:(NSRect)rect { [[NSColor windowBackgroundColor] set]; NSRectFill(rect); }
@end
#endif
