const std=@import("std");const c=@import("common.zig");const u=c.u;
var child: ?u.Handle=null;
pub fn attempt() !void {
    try c.save("Boot-01-start.txt","MavericksResurrection boot diagnostic v1\r\nOnly preboot checkpoints are captured. No claim of kernel-console capture.\r\n");
    var guidhex:[32]u8=undefined;c.print("Target GPT GUID (raw bytes): ");c.print(c.hex(c.config[8..24],&guidhex));c.print("\r\n");
    const bs=try c.bs();
    const handles=(try bs.locateHandleBuffer(.{.by_protocol=&u.protocol.SimpleFileSystem.guid})) orelse return error.NoFilesystems;
    defer bs.freePool(@ptrCast(@alignCast(handles.ptr))) catch {};
    if(handles.len>4096) return error.TooManyHandles;
    var chosen: ?u.Handle=null;
    for(handles) |h| {
        const dp=(try bs.handleProtocol(u.protocol.DevicePath,h)) orelse continue;
        const raw=c.pathBytes(dp) catch continue;
        const guid=(c.partitionGuid(raw) catch continue) orelse continue;
        if(std.mem.eql(u8,&guid,c.config[8..24])) {if(chosen!=null) return error.AmbiguousTarget;chosen=h;}
    }
    const target=chosen orelse return error.TargetNotExposedByFirmware;
    const dp=(try bs.handleProtocol(u.protocol.DevicePath,target)) orelse return error.NoTargetPath;
    const raw=try c.pathBytes(dp);try c.save("02-target-devicepath.bin",raw);
    const fs=(try bs.handleProtocol(u.protocol.SimpleFileSystem,target)) orelse return error.NoTargetFilesystem;
    var hash: [32]u8=undefined;
    {
        const root=try fs.openVolume();defer root.close() catch {};
        const f=try root.open(c.w(c.boot_path),.read,.{});defer f.close() catch {};
        var digest=std.crypto.hash.sha2.Sha256.init(.{});var buf:[65536]u8=undefined;var size:u64=0;
        while(true) {const n=try f.read(&buf);if(n==0) break;size+=n;if(size>16*1024*1024) return error.LoaderTooLarge;digest.update(buf[0..n]);}
        digest.final(&hash);
        if(size!=std.mem.readInt(u64,c.config[56..64],.little) or !std.mem.eql(u8,&hash,c.config[24..56])) return error.BootLoaderChanged;
    }
    var hex:[64]u8=undefined;try c.save("03-loader-verified.txt",c.hex(&hash,&hex));
    c.print("This will boot ONLY the selected Mavericks partition.\r\nMavericks can write to its disks during boot; this is not a read-only test.\r\nPress Y to attempt boot, or N to return without booting: ");
    if(!try c.yes()) {try c.save("CANCELLED.txt","No boot requested.\r\n");return;}
    // Build a full device path without installing protocols or changing boot variables.
    var full:[8192]u8 align(8)=undefined;
    const prefix=raw.len-4;
    const node_len=4+(c.boot_path.len+1)*2;
    if(prefix+node_len+4>full.len) return error.PathTooLong;
    @memcpy(full[0..prefix],raw[0..prefix]);full[prefix]=4;full[prefix+1]=4;
    std.mem.writeInt(u16,full[prefix+2..][0..2],@intCast(node_len),.little);
    for(c.boot_path,0..) |v,i| std.mem.writeInt(u16,full[prefix+4+2*i..][0..2],v,.little);
    std.mem.writeInt(u16,full[prefix+node_len-2..][0..2],0,.little);
    @memcpy(full[prefix+node_len..][0..4],&[_]u8{0x7f,0xff,4,0});
    try c.save("04-before-loadimage.txt","Loading the verified boot.efi from the selected partition. No boot arguments or NVRAM are changed.\r\n");
    child=try bs.loadImage(false,u.handle,.{.device_path=@ptrCast(&full)});
    errdefer if(child) |h| { _=bs.unloadImage(h) catch {}; };
    try c.save("05-before-startimage.txt","LoadImage succeeded. About to call StartImage. All diagnostic file handles are closed before handoff.\r\nThis checkpoint alone does NOT prove Mavericks started or booted successfully.\r\n");
    // Keep no filesystem handles across the handoff. A normal OS boot never returns.
    c.close();
    const result=bs.startImage(child.?) catch |err| {
        try c.init("boot-return");try c.save("STARTIMAGE-ERROR.txt",@errorName(err));return err;
    };
    try c.init("boot-return");
    var report:[256]u8=undefined;
    try c.save("STARTIMAGE-RETURNED.txt",try std.fmt.bufPrint(&report,"boot.efi returned to firmware: 0x{x}\r\nMavericks boot has NOT been confirmed.\r\n",.{@intFromEnum(result.code)}));
    _=bs.unloadImage(child.?) catch {};child=null;
}
pub fn main() u.Status {
    c.print("MavericksResurrection boot diagnostic\r\n");
    c.init("boot") catch |err| return c.fail(err);
    attempt() catch |err| return c.fail(err);
    c.close();return .success;
}
