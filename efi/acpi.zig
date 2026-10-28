const std=@import("std");
const c=@import("common.zig");
const u=c.u;
const File=c.File;
const p=@import("acpi_parse.zig");
var map_storage: [512 * 1024]u8 align(8) = undefined;
var memory: u.tables.MemoryMapSlice = undefined;
var seen: [512]u64 = undefined;
var seen_count: usize = 0;
var saved_count: usize = 0;
var ssdt_count: usize = 0;
var dsdt_count: usize = 0;
var inventory: *File = undefined;

fn readMemory(address: u64, length: usize) ![]const u8 {
    if (length == 0 or length > 1024 * 1024) return error.BadLength;
    var it = memory.iterator();
    while (it.next()) |d| {
        if (d.attribute.rp) continue;
        switch (d.type) {
            .acpi_reclaim_memory, .acpi_memory_nvs, .boot_services_code, .boot_services_data, .runtime_services_code, .runtime_services_data, .loader_code, .loader_data, .reserved_memory_type => {},
            else => continue,
        }
        if (p.rangeInside(address, length, d.physical_start, d.number_of_pages)) {
            const ptr: [*]const u8 = @ptrFromInt(address);
            return ptr[0..length];
        }
    }
    return error.UnmappedTable;
}
fn table(address: u64) ![]const u8 {
    const header = try readMemory(address, 36);
    const data = try readMemory(address, try p.tableLength(header));
    try p.validateTable(data);
    return data;
}
fn writeAll(f: *File, data: []const u8) !void {
    if(try f.write(data)!=data.len) return error.ShortWrite;
}
fn save(name: []const u8, data: []const u8) !void {
    try c.save(name,data);
    var hash:[32]u8=undefined;
    std.crypto.hash.sha2.Sha256.hash(data,&hash,.{});
    var hx:[64]u8=undefined;var line:[256]u8=undefined;
    try writeAll(inventory,try std.fmt.bufPrint(&line,"saved\t{s}\t{d}\t{s}\r\n",.{name,data.len,c.hex(&hash,&hx)}));
    try inventory.flush();
    saved_count+=1;
}
fn visit(address: u64) anyerror!void {
    for (seen[0..seen_count]) |a| if (a == address) return;
    if (seen_count == seen.len) return error.TooManyTables;
    const data = try table(address);
    seen[seen_count] = address;
    seen_count += 1;
    var line: [160]u8 = undefined;
    try writeAll(inventory, try std.fmt.bufPrint(&line, "table\t{d}\t{s}\t0x{x}\t{d}\r\n", .{ seen_count, data[0..4], address, data.len }));
    if (p.retain(data[0..4])) {
        var name: [40]u8 = undefined;
        try save(try std.fmt.bufPrint(&name, "{d:0>3}-{s}.dat", .{ seen_count, data[0..4] }), data);
    }
    if (std.mem.eql(u8, data[0..4], "SSDT")) ssdt_count += 1;
    if (std.mem.eql(u8, data[0..4], "DSDT")) dsdt_count += 1;
    if (std.mem.eql(u8, data[0..4], "FACP")) {
        var dsdt: u64 = 0;
        if (data.len >= 148) dsdt = try p.u64le(data, 140);
        if (dsdt == 0) dsdt = try p.u32le(data, 40);
        if (dsdt == 0) return error.NoDsdt;
        const d = try table(dsdt);
        if (!std.mem.eql(u8, d[0..4], "DSDT")) return error.WrongDsdt;
        try visit(dsdt);
    }
}
fn walkRoot(address: u64, width: usize) !void {
    const data = try table(address);
    const n = try p.rootEntryCount(data, width);
    try visit(address);
    for (0..n) |i| {
        const child = if (width == 8) try p.u64le(data, 36 + i * 8) else try p.u32le(data, 36 + i * 4);
        if (child == 0) return error.NullTable;
        try visit(child);
    }
}
fn captureRsdp(address: u64, index: usize) !void {
    var data = try readMemory(address, 20);
    if (!std.mem.eql(u8, data[0..8], "RSD PTR ")) return error.BadRsdp;
    if (data[15] >= 2) {
        const header = try readMemory(address, 36);
        const n = try p.u32le(header, 20);
        if (n < 36 or n > 4096) return error.BadLength;
        data = try readMemory(address, n);
    }
    try p.validateRsdp(data);
    var name: [40]u8 = undefined;
    try save(try std.fmt.bufPrint(&name, "RSDP-{d}.dat", .{index}), data);
    const rsdt = try p.u32le(data, 16);
    const xsdt = if (data[15] >= 2) try p.u64le(data, 24) else 0;
    if (rsdt == 0 and xsdt == 0) return error.NoRoot;
    if (xsdt != 0) try walkRoot(xsdt, 8);
    if (rsdt != 0) try walkRoot(rsdt, 4);
}
pub fn capture() !void {
    const bs=try c.bs();
    inventory=try c.output.?.open(c.w("ACPI-inventory.txt"),.read_write_create,.{});
    defer inventory.close() catch {};
    memory = try bs.getMemoryMap(&map_storage);
    if (memory.info.descriptor_size < @sizeOf(u.tables.MemoryDescriptor)) return error.BadMemoryMap;
    const cfg = u.system_table.configuration_table;
    if (u.system_table.number_of_table_entries > 1024) return error.TooManyConfigEntries;
    var count: usize = 0;
    for (cfg[0..u.system_table.number_of_table_entries]) |entry| {
        const ct = u.tables.ConfigurationTable;
        if (entry.vendor_guid.eql(ct.acpi_20_table_guid) or entry.vendor_guid.eql(ct.acpi_10_table_guid)) {
            try captureRsdp(@intFromPtr(entry.vendor_table), count);
            count += 1;
        }
    }
    if (count == 0 or dsdt_count == 0) return error.IncompleteNamespace;
    var end: [160]u8 = undefined;
    try writeAll(inventory, try std.fmt.bufPrint(&end, "COMPLETE\troot-pointers={d}\tunique-tables={d}\tSSDT={d}\tDSDT={d}\tfiles={d}\r\n", .{ count, seen_count, ssdt_count, dsdt_count, saved_count }));
    try inventory.flush();
}
