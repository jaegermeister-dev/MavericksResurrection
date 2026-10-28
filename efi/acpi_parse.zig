// Bounds/checksum logic shared by the read-only EFI collector and host tests.
const std = @import("std");

pub fn u32le(b: []const u8, at: usize) !u32 {
    if (at > b.len or b.len - at < 4) return error.Truncated;
    return std.mem.readInt(u32, b[at..][0..4], .little);
}
pub fn u64le(b: []const u8, at: usize) !u64 {
    if (at > b.len or b.len - at < 8) return error.Truncated;
    return std.mem.readInt(u64, b[at..][0..8], .little);
}
pub fn checksum(b: []const u8) bool {
    var sum: u8 = 0;
    for (b) |v| sum +%= v;
    return sum == 0;
}
pub fn tableLength(header: []const u8) !usize {
    if (header.len < 36) return error.Truncated;
    for (header[0..4]) |c| if (!(c >= 'A' and c <= 'Z') and !(c >= '0' and c <= '9') and c != '_') return error.BadSignature;
    const n = try u32le(header, 4);
    if (n < 36 or n > 1024 * 1024) return error.BadLength;
    return n;
}
pub fn validateTable(b: []const u8) !void {
    if (try tableLength(b) != b.len) return error.BadLength;
    if (!checksum(b)) return error.BadChecksum;
}
pub fn validateRsdp(b: []const u8) !void {
    if (b.len < 20 or !std.mem.eql(u8, b[0..8], "RSD PTR ")) return error.BadRsdp;
    if (!checksum(b[0..20])) return error.BadChecksum;
    if (b[15] >= 2) {
        const n = try u32le(b, 20);
        if (n < 36 or n > 4096 or n != b.len) return error.BadLength;
        if (!checksum(b)) return error.BadChecksum;
    } else if (b.len != 20) return error.BadLength;
}
pub fn rootEntryCount(b: []const u8, width: usize) !usize {
    try validateTable(b);
    if (width != 4 and width != 8) return error.BadWidth;
    if (!std.mem.eql(u8, b[0..4], if (width == 8) "XSDT" else "RSDT")) return error.BadSignature;
    if ((b.len - 36) % width != 0) return error.BadLength;
    const n = (b.len - 36) / width;
    if (n > 512) return error.TooManyTables;
    return n;
}
pub fn retain(sig: []const u8) bool {
    // Namespace tables plus graphics/PCI provenance; exclude licensing/SMBIOS.
    for ([_][]const u8{ "DSDT", "SSDT", "PSDT", "FACP", "VFCT", "MCFG", "RSDT", "XSDT" }) |s| {
        if (std.mem.eql(u8, sig, s)) return true;
    }
    return false;
}
pub fn rangeInside(start: u64, length: usize, region: u64, pages: u64) bool {
    if (start == 0 or length == 0 or pages > std.math.maxInt(u64) / 4096) return false;
    const span = pages * 4096;
    if (span > std.math.maxInt(u64) - region or length > std.math.maxInt(u64) - start) return false;
    if (start < region or start - region > span) return false;
    return length <= span - (start - region);
}

fn finish(b: []u8) void {
    b[9] = 0;
    var sum: u8 = 0;
    for (b) |v| sum +%= v;
    b[9] = 0 -% sum;
}
test "bounds and overflow" {
    try std.testing.expect(rangeInside(0x1010, 10, 0x1000, 1));
    try std.testing.expect(!rangeInside(0, 10, 0, 1));
    try std.testing.expect(!rangeInside(0x1fff, 2, 0x1000, 1));
    try std.testing.expect(!rangeInside(0x1000, 1, 0x1000, std.math.maxInt(u64)));
    try std.testing.expect(!rangeInside(std.math.maxInt(u64) - 8, 16, std.math.maxInt(u64) - 4095, 1));
    try std.testing.expectError(error.Truncated, u64le(&.{ 0, 0, 0 }, 0));
    try std.testing.expectError(error.Truncated, u32le(&.{ 0, 0, 0, 0 }, std.math.maxInt(usize)));
}
test "XSDT checks and duplicate signatures are retained independently" {
    var b: [52]u8 = @splat(0);
    @memcpy(b[0..4], "XSDT");
    b[4] = 52;
    finish(&b);
    try std.testing.expectEqual(@as(usize, 2), try rootEntryCount(&b, 8));
    b[9] +%= 1;
    try std.testing.expectError(error.BadChecksum, validateTable(&b));
    b[4] = 35;
    try std.testing.expectError(error.BadLength, tableLength(&b));
    try std.testing.expect(retain("SSDT"));
    try std.testing.expect(!retain("MSDM"));
    try std.testing.expect(!retain("SLIC"));
}
test "RSDP checks" {
    var b: [36]u8 = @splat(0);
    @memcpy(b[0..8], "RSD PTR ");
    b[15] = 2;
    b[20] = 36;
    var sum: u8 = 0;
    for (b[0..20]) |v| sum +%= v;
    b[8] = 0 -% sum;
    sum = 0;
    for (b) |v| sum +%= v;
    b[32] = 0 -% sum;
    try validateRsdp(&b);
    b[32] +%= 1;
    try std.testing.expectError(error.BadChecksum, validateRsdp(&b));
    try std.testing.expectError(error.BadRsdp, validateRsdp(b[0..19]));
}
