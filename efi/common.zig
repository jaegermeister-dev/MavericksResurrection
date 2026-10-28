const std = @import("std");
pub const u = std.os.uefi;
pub const File = u.protocol.File;
pub const w = std.unicode.utf8ToUtf16LeStringLiteral;
pub const marker = "MavericksResurrection EFI diagnostics v1\n";
pub const boot_path = "\\System\\Library\\CoreServices\\boot.efi";
pub var session: ?*File = null;
pub var output: ?*File = null;
var root: ?*File = null;
var bytes_written: usize = 0;
pub var config: [64]u8 = undefined;
pub var session_path: [512:0]u16 = undefined;

pub fn bs() !*u.tables.BootServices { return u.system_table.boot_services orelse error.NoBootServices; }
pub fn print(s: []const u8) void {
    var text: [256:0]u16 = undefined;
    var offset: usize = 0;
    while (offset < s.len) {
        const n = @min(256, s.len - offset);
        for (s[offset..][0..n], 0..) |c,i| text[i] = c;
        text[n] = 0;
        if (u.system_table.con_out) |con| _ = con.outputString(@ptrCast(&text)) catch false;
        offset += n;
    }
}
pub fn wide(buf: []u16, s: []const u8) ![*:0]const u16 {
    if (s.len >= buf.len) return error.NameTooLong;
    for (s,0..) |c,i| { if(c < 32 or c > 126) return error.NonAsciiPath; buf[i]=c; }
    buf[s.len]=0;
    return @ptrCast(buf.ptr);
}
pub fn missing(dir: *File, name: [*:0]const u16) !bool {
    const f = dir.open(name,.read,.{}) catch |err| { if(err==error.NotFound) return true; return err; };
    try f.close(); return false;
}
pub fn readExact(dir: *File, name: [*:0]const u16, buffer: []u8) !void {
    const f = try dir.open(name,.read,.{}); defer f.close() catch {};
    var n: usize=0;
    while(n<buffer.len) { const got=try f.read(buffer[n..]); if(got==0) return error.Truncated; n+=got; }
    var tail: [1]u8=undefined; if(try f.read(&tail)!=0) return error.UnexpectedLength;
}
pub fn pathBytes(path: *const u.protocol.DevicePath) ![]const u8 {
    const raw: [*]const u8 = @ptrCast(path);
    var pos: usize=0;
    while(pos<4096) {
        const n=std.mem.readInt(u16,raw[pos+2..][0..2],.little);
        if(n<4 or n>4096-pos) return error.BadDevicePath;
        if(raw[pos]==0x7f) {
            if(raw[pos+1]!=0xff or n!=4) return error.MultiInstancePath;
            return raw[0..pos+4];
        }
        pos+=n;
    }
    return error.PathTooLong;
}
pub fn partitionGuid(raw: []const u8) !?[16]u8 {
    var pos: usize=0; var found: ?[16]u8=null;
    while(pos<raw.len) {
        if(raw.len-pos<4) return error.BadDevicePath;
        const n=std.mem.readInt(u16,raw[pos+2..][0..2],.little);
        if(n<4 or n>raw.len-pos) return error.BadDevicePath;
        if(raw[pos]==4 and raw[pos+1]==1) {
            if(n!=42 or raw[pos+40]!=2 or raw[pos+41]!=2 or found!=null) return error.NotSingleGptPartition;
            found=raw[pos+24..][0..16].*;
        }
        pos+=n;
    }
    return found;
}
pub fn ownDirectory(path: []const u8) !void {
    var ascii: [512]u8=undefined; var count: usize=0; var pos: usize=0;
    while(pos<path.len) {
        const n=std.mem.readInt(u16,path[pos+2..][0..2],.little);
        if(path[pos]==4 and path[pos+1]==4) {
            if(n<6 or n%2!=0) return error.BadFilePath;
            var off:usize=4;
            while(off<n-2):(off+=2) {
                const c=std.mem.readInt(u16,path[pos+off..][0..2],.little);
                if(c<32 or c>126 or count>=ascii.len) return error.BadFilePath;
                ascii[count]=@intCast(c);count+=1;
            }
            if(std.mem.readInt(u16,path[pos+n-2..][0..2],.little)!=0) return error.BadFilePath;
        }
        pos+=n;
    }
    const slash=std.mem.lastIndexOfScalar(u8,ascii[0..count],'\\') orelse return error.NoParent;
    const parent=ascii[0..slash];
    const prefix="\\EFI\\MavericksResurrection-Diagnostics\\case-";
    if(!std.ascii.startsWithIgnoreCase(parent,prefix)) return error.WrongDirectory;
    for(parent[prefix.len..]) |c| if(!std.ascii.isAlphanumeric(c) and c!='-') return error.WrongDirectory;
    if(parent.len<=prefix.len or parent.len>250) return error.WrongDirectory;
    _=try wide(&session_path,parent);
}
pub fn init(kind: []const u8) !void {
    const services=try bs();
    const loaded=(try services.handleProtocol(u.protocol.LoadedImage,u.handle)) orelse return error.NoLoadedImage;
    try ownDirectory(try pathBytes(loaded.file_path));
    const device=loaded.device_handle orelse return error.NoDevice;
    const fs=(try services.handleProtocol(u.protocol.SimpleFileSystem,device)) orelse return error.NoFilesystem;
    root=try fs.openVolume();
    session=try root.?.open(@ptrCast(&session_path),.read,.{});
    var allow: [marker.len]u8=undefined;
    try readExact(session.?,w("ALLOW-DIAGNOSTICS.txt"),&allow);
    if(!std.mem.eql(u8,&allow,marker)) return error.WrongMarker;
    try readExact(session.?,w("target.bin"),&config);
    if(!std.mem.eql(u8,config[0..8],"MRDIAG01")) return error.BadConfig;
    const size=std.mem.readInt(u64,config[56..64],.little);
    if(size==0 or size>16*1024*1024) return error.BadLoaderSize;
    var guid_nonzero=false; for(config[8..24]) |b| {if(b!=0) guid_nonzero=true;}
    if(!guid_nonzero) return error.BadGuid;
    for(0..1000) |i| {
        var name: [64]u8=undefined;
        const s=try std.fmt.bufPrint(&name,"{s}-{d:0>3}",.{kind,i});
        var path: [64]u16=undefined;const z=try wide(&path,s);
        if(try missing(session.?,z)) {
            output=try session.?.open(z,.read_write_create,.{.directory=true});
            print("Report directory: ");print(s);print("\r\n");
            try save("target.bin",&config);
            return;
        }
    }
    return error.NoUnusedDirectory;
}
pub fn close() void {
    if(output) |f| f.close() catch {}; output=null;
    if(session) |f| f.close() catch {}; session=null;
    if(root) |f| f.close() catch {}; root=null;
}
pub fn save(name: []const u8, data: []const u8) !void {
    if(data.len>16*1024*1024-bytes_written) return error.ReportTooLarge;
    for(name) |c| if(!std.ascii.isAlphanumeric(c) and c!='-' and c!='_' and c!='.') return error.BadName;
    if(name.len==0 or std.mem.eql(u8,name,".") or std.mem.eql(u8,name,"..")) return error.BadName;
    var path: [128]u16=undefined; const z=try wide(&path,name);
    const dir=output orelse return error.NoOutput;
    if(!try missing(dir,z)) return error.WouldOverwrite;
    const f=try dir.open(z,.read_write_create,.{});
    var closed=false; defer if(!closed) f.close() catch {};
    if(try f.write(data)!=data.len) return error.ShortWrite;
    try f.flush();try f.setPosition(0);
    var buf: [4096]u8=undefined;var pos:usize=0;
    while(pos<data.len) {
        const n=@min(buf.len,data.len-pos);
        if(try f.read(buf[0..n])!=n or !std.mem.eql(u8,buf[0..n],data[pos..][0..n])) return error.ReadbackMismatch;
        pos+=n;
    }
    try f.close();closed=true;bytes_written+=data.len;
}
pub fn hex(bytes: []const u8, dest: []u8) []const u8 {
    const digits="0123456789abcdef";
    for(bytes,0..) |b,i| {dest[2*i]=digits[b>>4];dest[2*i+1]=digits[b&15];}
    return dest[0..bytes.len*2];
}
pub fn fail(err: anyerror) u.Status {
    if(output!=null) save("INCOMPLETE.txt",@errorName(err)) catch {};
    print("Stopped: ");print(@errorName(err));print("\r\nReturn to your working macOS and collect this report.\r\n");
    close();return .aborted;
}
pub fn yes() !bool {
    const con=u.system_table.con_in orelse return error.NoKeyboard;
    // Discard keys left over from launching the tool, then require a new Y.
    while(true) { _=con.readKeyStroke() catch |err| {if(err==error.NotReady) break;return err;}; }
    while(true) {
        const key=con.readKeyStroke() catch |err| {if(err==error.NotReady) {try (try bs()).stall(10000);continue;} return err;};
        if(key.unicode_char=='y' or key.unicode_char=='Y') return true;
        if(key.unicode_char=='n' or key.unicode_char=='N' or key.scan_code==0x17) return false;
    }
}
