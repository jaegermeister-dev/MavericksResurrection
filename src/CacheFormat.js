/* Bounded Mach-O inspection shared by native cache validation and Node evidence checks. */
var MavericksResurrectionCacheFormat = (function () {
    'use strict';
    function integer(n) { return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n && n <= 9007199254740991; }
    function range(offset, size, limit) {
        if (!integer(offset) || !integer(size) || !integer(limit) || offset > limit || size > limit - offset) throw new Error('Cache range exceeds its container.');
    }
    function u32(data, offset, big) {
        range(offset, 4, data.length);
        return big ? data[offset] * 16777216 + data[offset + 1] * 65536 + data[offset + 2] * 256 + data[offset + 3] :
            data[offset + 3] * 16777216 + data[offset + 2] * 65536 + data[offset + 1] * 256 + data[offset];
    }
    function u64(data, offset) {
        var value = u32(data, offset, false) + u32(data, offset + 4, false) * 4294967296;
        if (!integer(value)) throw new Error('Cache offset cannot be represented exactly.');
        return value;
    }
    function name(data, offset) {
        range(offset, 16, data.length);
        var text = '';
        for (var i = 0; i < 16 && data[offset + i]; i++) text += String.fromCharCode(data[offset + i]);
        return text;
    }
    function prelinkSection(reader) {
        function read(offset, size) {
            range(offset, size, reader.length);
            var data = reader.read(offset, size);
            if (!data || data.length !== size) throw new Error('Truncated cache read.');
            return data;
        }
        var first = read(0, 8), magic = u32(first, 0, true), slice = {offset: 0, size: reader.length};
        if (magic === 0xcafebabe) {
            var count = u32(first, 4, true), slices = [], selected = [];
            if (count < 1 || count > 8) throw new Error('Invalid cache architecture count.');
            var fat = read(8, count * 20);
            for (var i = 0; i < count; i++) {
                var item = {offset: u32(fat, i * 20 + 8, true), size: u32(fat, i * 20 + 12, true)};
                range(item.offset, item.size, reader.length);
                if (item.offset < 8 + fat.length || item.size < 32) throw new Error('Invalid cache architecture extent.');
                slices.forEach(function (other) {
                    if (item.offset < other.offset + other.size && other.offset < item.offset + item.size) throw new Error('Overlapping cache architectures.');
                });
                slices.push(item);
                if (u32(fat, i * 20, true) === 0x01000007) selected.push(item);
            }
            if (selected.length !== 1) throw new Error('Expected exactly one x86_64 cache architecture.');
            slice = selected[0];
        }
        var header = read(slice.offset, 32);
        if (u32(header, 0, false) !== 0xfeedfacf || u32(header, 4, false) !== 0x01000007) throw new Error('Expected an uncompressed x86_64 Mach-O cache.');
        var commands = u32(header, 16, false), commandBytes = u32(header, 20, false), position = 32, info = null;
        if (!commands || commands > 1024 || commandBytes > 1048576) throw new Error('Invalid cache load-command table.');
        range(32, commandBytes, slice.size);
        var end = 32 + commandBytes;
        for (var c = 0; c < commands; c++) {
            range(position, 8, end);
            var cmdHead = read(slice.offset + position, 8), cmd = u32(cmdHead, 0, false), size = u32(cmdHead, 4, false);
            if (size < 8 || size % 8) throw new Error('Invalid cache load-command size.');
            range(position, size, end);
            if (cmd === 0x19) {
                if (size < 72) throw new Error('Truncated Mach-O segment.');
                var segment = read(slice.offset + position, size), sections = u32(segment, 64, false);
                if (size !== 72 + sections * 80) throw new Error('Invalid Mach-O section table.');
                var segmentOffset = u64(segment, 40), segmentSize = u64(segment, 48);
                range(segmentOffset, segmentSize, slice.size);
                for (var s = 0; s < sections; s++) {
                    var at = 72 + s * 80;
                    if (name(segment, at) === '__info' && name(segment, at + 16) === '__PRELINK_INFO') {
                        if (info || name(segment, 8) !== '__PRELINK_INFO') throw new Error('Ambiguous prelink information section.');
                        var length = u64(segment, at + 40), offset = u32(segment, at + 48, false);
                        range(offset, length, slice.size);
                        if (!length || length > 32 * 1024 * 1024 || offset < end || offset < segmentOffset ||
                            length > segmentOffset + segmentSize - offset) throw new Error('Invalid prelink information extent.');
                        info = {offset: slice.offset + offset, length: length};
                    }
                }
            }
            position += size;
        }
        if (position !== end || !info) throw new Error('Missing or malformed prelink information.');
        return info;
    }
    return {prelinkSection: prelinkSection};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionCacheFormat;
