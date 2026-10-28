const std=@import("std");const c=@import("common.zig");const u=c.u;
const PciIo=extern struct {
    unused_io_methods:[6]usize,
    read_config:*const fn(*PciIo,u32,u32,usize,*anyopaque) callconv(u.cc) u.Status,
    unused_write_config:usize,
    unused_dma_methods:[6]usize,
    get_location:*const fn(*PciIo,*usize,*usize,*usize,*usize) callconv(u.cc) u.Status,
    pub const guid align(8)=u.Guid{.time_low=0x4cf5b200,.time_mid=0x68b8,.time_high_and_version=0x4ca5,.clock_seq_high_and_reserved=0x9e,.clock_seq_low=0xec,.node=.{0xb2,0x3e,0x3f,0x50,0x02,0x9a}};
};
var text:[262144]u8=undefined;var used:usize=0;
fn line(comptime format:[]const u8,args:anytype) !void {const s=try std.fmt.bufPrint(text[used..],format,args);used+=s.len;}
fn pci() !void {
    used=0;try line("Conventional PCI configuration headers, read only. No BAR sizing or PCI/MMIO writes.\r\n",.{});
    const bs=try c.bs();
    const handles=(try bs.locateHandleBuffer(.{.by_protocol=&PciIo.guid})) orelse {try c.save("PCI-unavailable.txt","PCI I/O protocol not exposed.\r\n");return;};
    defer bs.freePool(@ptrCast(@alignCast(handles.ptr))) catch {};
    if(handles.len>1024) return error.TooManyPciHandles;
    for(handles) |h| {
        const p=(try bs.handleProtocol(PciIo,h)) orelse continue;
        var s:usize=0;var b:usize=0;var d:usize=0;var f:usize=0;
        const status=p.get_location(p,&s,&b,&d,&f);
        if(status!=.success) {try line("GetLocation error {s}\r\n",.{@tagName(status)});continue;}
        if(s>65535 or b>255 or d>31 or f>7) return error.InvalidPciAddress;
        var bytes:[64]u8=undefined;const rc=p.read_config(p,0,0,bytes.len,&bytes);
        if(rc!=.success) {try line("{x}:{x}:{x}.{x} read error {s}\r\n",.{s,b,d,f,@tagName(rc)});continue;}
        var hx:[128]u8=undefined;
        try line("{x:0>4}:{x:0>2}:{x:0>2}.{x} vendor={x:0>4} device={x:0>4} class={x:0>2}{x:0>2}{x:0>2} revision={x:0>2} header={s}\r\n",.{s,b,d,f,std.mem.readInt(u16,bytes[0..2],.little),std.mem.readInt(u16,bytes[2..4],.little),bytes[11],bytes[10],bytes[9],bytes[8],c.hex(&bytes,&hx)});
    }
    try c.save("PCI.txt",text[0..used]);
}
fn graphics() !void {
    used=0;const bs=try c.bs();
    const handles=(try bs.locateHandleBuffer(.{.by_protocol=&u.protocol.GraphicsOutput.guid})) orelse {try c.save("GOP-unavailable.txt","No Graphics Output Protocol. This does not prove a graphics fault.\r\n");return;};
    defer bs.freePool(@ptrCast(@alignCast(handles.ptr))) catch {};
    if(handles.len>32) return error.TooManyGraphicsHandles;
    for(handles,0..) |h,index| {
        const g=(try bs.handleProtocol(u.protocol.GraphicsOutput,h)) orelse continue;
        const mode=g.mode;const info=mode.info;
        try line("GOP {d}: current={d} available={d} resolution={d}x{d} stride={d} framebuffer=0x{x} bytes={d}\r\n",.{index,mode.mode,mode.max_mode,info.horizontal_resolution,info.vertical_resolution,info.pixels_per_scan_line,mode.frame_buffer_base,mode.frame_buffer_size});
        if(mode.max_mode>1024) return error.TooManyGraphicsModes;
        for(0..mode.max_mode) |m| {
            const detail=g.queryMode(@intCast(m)) catch |err| {try line("mode {d}: {s}\r\n",.{m,@errorName(err)});continue;};
            defer bs.freePool(@ptrCast(@alignCast(detail))) catch {};
            try line("mode {d}: {d}x{d} stride={d} pixel-format={d}\r\n",.{m,detail.horizontal_resolution,detail.vertical_resolution,detail.pixels_per_scan_line,@intFromEnum(detail.pixel_format)});
        }
    }
    try c.save("Graphics.txt",text[0..used]);
}
fn filesystems() !void {
    used=0;const bs=try c.bs();
    const handles=(try bs.locateHandleBuffer(.{.by_protocol=&u.protocol.SimpleFileSystem.guid})) orelse return error.NoFilesystems;
    defer bs.freePool(@ptrCast(@alignCast(handles.ptr))) catch {};
    if(handles.len>4096) return error.TooManyFilesystems;
    try line("Filesystem device paths as exposed by the current firmware/bootloader environment. No target files were opened.\r\nGUID values below are raw GPT signature bytes (little-endian first fields).\r\n",.{});
    for(handles,0..) |h,index| {
        const dp=(try bs.handleProtocol(u.protocol.DevicePath,h)) orelse continue;
        const raw=c.pathBytes(dp) catch |err| {try line("filesystem {d}: {s}\r\n",.{index,@errorName(err)});continue;};
        const guid=c.partitionGuid(raw) catch null;
        var gh:[32]u8=undefined;
        try line("filesystem {d}: guid={s} selected={any}\r\n",.{index,if(guid) |g| c.hex(&g,&gh) else "unavailable",if(guid) |g| std.mem.eql(u8,&g,c.config[8..24]) else false});
        var name:[64]u8=undefined;
        try c.save(try std.fmt.bufPrint(&name,"filesystem-{d:0>3}-devicepath.bin",.{index}),raw);
    }
    try c.save("Filesystems.txt",text[0..used]);
}
pub fn capture() !void {
    var vendor:[128]u8=undefined;var n:usize=0;
    while(n<vendor.len and u.system_table.firmware_vendor[n]!=0):(n+=1) {const v=u.system_table.firmware_vendor[n];vendor[n]=if(v>=32 and v<127) @intCast(v) else '?';}
    used=0;
    try line("MavericksResurrection EFI hardware report v1\r\nFirmware={s} revision=0x{x} UEFI=0x{x}\r\nNo firmware settings, PCI configuration, ACPI tables or boot selection changed.\r\nIf launched through OpenCore this describes the environment AFTER its changes.\r\n",.{vendor[0..n],u.system_table.firmware_revision,u.system_table.hdr.revision});
    try c.save("01-start.txt",text[0..used]);
    var incomplete=false;
    pci() catch |err| {incomplete=true;try c.save("PCI-error.txt",@errorName(err));};
    graphics() catch |err| {incomplete=true;try c.save("Graphics-error.txt",@errorName(err));};
    filesystems() catch |err| {incomplete=true;try c.save("Filesystems-error.txt",@errorName(err));};
    @import("acpi.zig").capture() catch |err| {incomplete=true;try c.save("ACPI-error.txt",@errorName(err));};
    if(incomplete) {try c.save("PARTIAL.txt","One or more sections could not be collected. See section error files.\r\n");c.print("Partial report saved.\r\n");}
    else {try c.save("COMPLETE.txt","All requested hardware collection stages completed. See the boot checkpoints, if any, for the selected mode.\r\n");c.print("Hardware report saved.\r\n");}
}
pub fn main() u.Status {
    c.print("MavericksResurrection hardware diagnostics\r\n");
    c.init("hardware") catch |err| return c.fail(err);
    capture() catch |err| return c.fail(err);
    c.close();c.print("Return to your working macOS and collect the report.\r\n");return .success;
}
