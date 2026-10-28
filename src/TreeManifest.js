/* Validate native scanner output and compare a staged tree with its copy.
 * Ignore only symlink modification times: macOS ditto recreates symlinks with
 * a fresh timestamp. Link destinations, ACLs, ownership and attributes still
 * must match. Kernel, kext, directory and ordinary file times must match. */
var MavericksResurrectionTreeManifest = (function () {
    'use strict';
    function integer(n, minimum, maximum) {
        return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= minimum && n <= maximum;
    }
    function path(value) {
        return typeof value === 'string' && (value === '' || !value.split('/').some(function (p) { return !p || p === '.' || p === '..'; })) && value.indexOf('\x00') < 0;
    }
    function hash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
    function canonical(value) {
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
        return JSON.stringify(value);
    }
    function validate(records) {
        if (!Array.isArray(records) || records.length < 2) throw new Error('Incomplete filesystem manifest.');
        var complete = records[records.length - 1], rows = records.slice(0, -1), seen = Object.create(null), total = 0;
        if (!complete || complete.type !== 'complete' || complete.schema !== 1 || complete.entries !== rows.length) throw new Error('Missing or inconsistent manifest completion record.');
        rows.forEach(function (r, index) {
            if (!r || r.type !== 'entry' || !path(r.path) || seen[r.path] || (index === 0 && (r.path !== '' || r.kind !== 'directory')) ||
                ['file', 'directory', 'symlink'].indexOf(r.kind) < 0 || !integer(r.mode, 0, 4095) ||
                !integer(r.uid, 0, 4294967295) || !integer(r.gid, 0, 4294967295) || !integer(r.flags, 0, 4294967295) ||
                !integer(r.mtimeSeconds, -9007199254740991, 9007199254740991) || !integer(r.mtimeNanoseconds, 0, 999999999) ||
                typeof r.acl !== 'string' || !Array.isArray(r.xattrs)) throw new Error('Invalid filesystem manifest entry.');
            if (index) {
                var parent = r.path.slice(0, Math.max(0, r.path.lastIndexOf('/')));
                if (!seen[parent] || seen[parent].kind !== 'directory') throw new Error('Manifest parent is missing or not a directory: ' + r.path);
            }
            var attrs = Object.create(null);
            r.xattrs.forEach(function (a) {
                if (!a || typeof a.name !== 'string' || !a.name || attrs[a.name] || !integer(a.bytes, 0, 9007199254740991) || !hash(a.sha256)) throw new Error('Invalid extended attribute record.');
                attrs[a.name] = true;
            });
            if (r.kind === 'file') {
                if (!integer(r.bytes, 0, 9007199254740991) || !hash(r.sha256) || r.link !== undefined) throw new Error('Invalid manifest file.');
                total += r.bytes;
                if (r.hardlinkTo !== undefined) {
                    if (!path(r.hardlinkTo)) throw new Error('Invalid hardlink path.');
                    var target = r.hardlinkTo === r.path ? r : seen[r.hardlinkTo];
                    if (!target || target.kind !== 'file' || target.hardlinkTo !== r.hardlinkTo || target.bytes !== r.bytes || target.sha256 !== r.sha256) throw new Error('Hardlink relationship differs.');
                }
            } else if (r.bytes !== undefined || r.sha256 !== undefined || r.hardlinkTo !== undefined ||
                (r.kind === 'symlink' ? typeof r.link !== 'string' || !r.link || r.link.indexOf('\x00') >= 0 : r.link !== undefined)) throw new Error('Invalid non-file entry.');
            seen[r.path] = r;
        });
        if (!integer(total, 0, 9007199254740991) || complete.logicalFileBytes !== total) throw new Error('Manifest byte count differs.');
        return {rows: rows, entries: rows.length, logicalFileBytes: total};
    }
    function comparable(row) {
        var result = {};
        Object.keys(row).forEach(function (key) {
            if (row.kind === 'symlink' && (key === 'mtimeSeconds' || key === 'mtimeNanoseconds')) return;
            result[key] = row[key];
        });
        result.xattrs = row.xattrs.slice().sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
        return canonical(result);
    }
    function compare(source, copied) {
        var a = validate(source), b = validate(copied);
        if (a.entries !== b.entries || a.logicalFileBytes !== b.logicalFileBytes) throw new Error('Copied filesystem member or byte count differs.');
        for (var i = 0; i < a.rows.length; i++) {
            if (comparable(a.rows[i]) !== comparable(b.rows[i])) throw new Error('Copied filesystem content or metadata differs: ' + a.rows[i].path);
        }
        return {matched: true, entries: a.entries, logicalFileBytes: a.logicalFileBytes,
            timestampException: 'Symlink timestamps are excluded; all link destinations and other metadata are checked.'};
    }
    function verifyPayload(records, expected, owners, includeRoot) {
        var rows = validate(records).rows;
        if (!includeRoot) rows = rows.slice(1);
        if (!Array.isArray(expected) || rows.length !== expected.length) throw new Error('Payload tree members differ.');
        var byPath = Object.create(null), wanted = Object.create(null);
        rows.forEach(function (row) { byPath[row.path] = row; });
        expected.forEach(function (entry) {
            if (!entry || !path(entry.path) || wanted[entry.path]) throw new Error('Invalid payload comparison entry.');
            wanted[entry.path] = true;
            var actual = byPath[entry.path];
            if (!actual || actual.kind !== entry.kind || (entry.kind !== 'symlink' && actual.mode !== entry.mode) ||
                (owners && (actual.uid !== entry.uid || actual.gid !== entry.gid))) throw new Error('Payload type or permissions differ: ' + entry.path);
            if (entry.kind === 'file' && (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256)) throw new Error('Payload file checksum differs: ' + entry.path);
            if (entry.kind === 'symlink' && actual.link !== entry.link) throw new Error('Payload symbolic link differs: ' + entry.path);
        });
        return {matched: true, entries: rows.length};
    }
    return {validate: validate, compare: compare, verifyPayload: verifyPayload, canonical: canonical};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionTreeManifest;
