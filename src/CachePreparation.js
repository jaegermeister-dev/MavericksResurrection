/* Generate Mavericks caches using only the staged OS, never the host's loaded kexts. */
var MavericksResurrectionCachePreparation = (function () {
    'use strict';
    var nvme = typeof MavericksNVMePolicy !== 'undefined' ? MavericksNVMePolicy : require('./NVMePolicy');
    var root = 'System/Library/Caches/com.apple.kext.caches/Startup/';
    var infoFiles = [root + 'IOKitPersonalities_x86_64.ioplist.gz', root + 'KextPropertyValues_OSBundleHelper_x86_64.plist.gz'];
    function id(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value); }
    function bundlePath(value) {
        return typeof value === 'string' && /^\/(System\/Library|Library)\/Extensions\/.+\.kext$/.test(value) &&
            !/[\\\x00-\x1f\x7f]/.test(value) && !value.split('/').slice(1).some(function (p) { return !p || p === '.' || p === '..'; });
    }
    function recordsCheck(records) {
        var seen = Object.create(null), paths = Object.create(null);
        if (!Array.isArray(records) || !records.length) throw new Error('No cache bundle records.');
        records.forEach(function (r) {
            if (!r || !id(r.id) || !bundlePath(r.path) || seen[r.id] || paths[r.path]) throw new Error('Invalid or duplicate cache bundle record.');
            seen[r.id] = r; paths[r.path] = true;
        });
        return seen;
    }
    function plan(profile, catalog, candidate, candidates) {
        if (['stock', 'MacBookPro11,4', 'MacBookPro11,5'].indexOf(profile) < 0) throw new Error('Unknown cache model profile.');
        if (!catalog || catalog.schema !== 1 || catalog.version !== '10.9.5' || catalog.build !== '13F34' ||
            catalog.architecture !== 'x86_64' || catalog.stockSelection !== 'local-root' ||
            catalog.kernelSHA256 !== '7910ba5869a70b245c6edb9990826bc64394ebe532050843138cf24b301c5fd0' ||
            !catalog.tool || catalog.tool.sha256 !== 'c12ccf4b72766263a77fd162c0e7ac631bffbc3eb22905da70a1a3b881ae479c') throw new Error('Unexpected Mavericks cache inputs.');
        recordsCheck(catalog.releasedRecords);
        if (catalog.releasedRecords.length !== 244) throw new Error('The released prelink manifest must have 244 bundles.');
        var selected = null, records = profile === 'stock' ? [] : catalog.releasedRecords.slice();
        if (candidate !== null) {
            selected = candidates && candidates.candidates.filter(function (c) { return c.id === candidate; });
            if (!selected || selected.length !== 1 || !selected[0].payloadVerified) throw new Error('Unknown NVMe cache candidate.');
            selected = selected[0];
            records = records.concat(nvme.cacheRecords(selected));
        }
        if (records.length) recordsCheck(records);
        return {profile: profile, selection: profile === 'stock' ? 'local-root' : 'released-244', records: records,
            candidate: selected, exact: profile !== 'stock'};
    }
    function argumentsFor(plan, output) {
        if (!/^\/private\/var\/tmp\/MavericksResurrection-Cache-[A-Fa-f0-9-]+\/uncompressed$/.test(output)) throw new Error('Unexpected private cache output.');
        var args = ['-prelinked-kernel', output, '-uncompressed', '-arch', 'x86_64', '-kernel', '/mach_kernel', '-volume-root', '/', '-print-diagnostics', '-verbose', '3'];
        if (plan.selection === 'local-root') args.push('-local-root');
        plan.records.forEach(function (r) { args.push('-bundle-id', r.id); });
        return args.concat(['--', '/System/Library/Extensions', '/Library/Extensions']);
    }
    function verifyRows(actual, expected, readBundle) {
        var byID = recordsCheck(actual), wanted = expected.records;
        wanted.forEach(function (r) {
            if (!byID[r.id] || byID[r.id].path !== r.path) throw new Error('Required driver is missing from the cache: ' + r.id);
        });
        if (expected.exact && actual.length !== wanted.length) throw new Error('The cache contains unexpected bundles.');
        if (!expected.exact) {
            ['com.apple.kpi.mach', 'com.apple.kpi.iokit', 'com.apple.iokit.IOStorageFamily', 'com.apple.iokit.IOPCIFamily'].forEach(function (required) {
                if (!byID[required]) throw new Error('Stock root cache is missing ' + required);
            });
        }
        var selectedIDs = wanted.map(function (r) { return r.id; });
        ['com.apple.iokit.IONVMeFamily', 'com.MinnowStor.NVMeGeneric', 'dev.Jaegermeister.MavericksNVMeCompatibility'].forEach(function (nvme) {
            if (byID[nvme] && selectedIDs.indexOf(nvme) < 0) throw new Error('Unselected experimental driver in cache.');
        });
        actual.forEach(function (r) {
            var metadata = readBundle(r.path);
            if (!r.version || metadata.CFBundleIdentifier !== r.id || metadata.CFBundleVersion !== r.version) throw new Error('Cached driver identity differs from the installed bundle: ' + r.path);
        });
        return actual.length;
    }
    function prepare(io, profile, catalog, candidate, candidates) {
        var selected = plan(profile, catalog, candidate, candidates);
        io.assertPrivateStage();
        io.verifyFile('mach_kernel', catalog.kernelSHA256);
        io.verifyFile('usr/sbin/kextcache', catalog.tool.sha256);
        if (selected.candidate) io.verifyCandidate(selected.candidate);
        // Verify the explicit inputs before moving any old caches.
        selected.records.forEach(function (r) { if (io.readBundle(r.path).CFBundleIdentifier !== r.id) throw new Error('Installed bundle does not match prelink manifest: ' + r.path); });
        var workspace = io.begin();
        io.progress('Building Mavericks startup information caches (0 of 6 stages complete).',0);
        io.runKextcache(['-system-caches', '-arch', 'x86_64', '-verbose', '3']);
        infoFiles.forEach(function (file) { io.verifyGzip(file); });
        io.progress('Building the Mavericks boot cache (1 of 6 stages complete).',100/6);
        io.runKextcache(argumentsFor(selected, '/' + workspace + '/uncompressed'));
        var count = verifyRows(io.prelinkRows(workspace + '/uncompressed'), selected, io.readBundle);
        io.progress('Compressing the verified boot cache (2 of 6 stages complete).',200/6);
        io.copy(workspace + '/uncompressed', workspace + '/compressed');
        io.runKextcache(['-prelinked-kernel', '/' + workspace + '/compressed', '-compressed']);
        io.progress('Checking the compressed boot cache (3 of 6 stages complete).',50);
        io.copy(workspace + '/compressed', workspace + '/roundtrip');
        io.runKextcache(['-prelinked-kernel', '/' + workspace + '/roundtrip', '-uncompressed']);
        if (io.sha256(workspace + '/uncompressed') !== io.sha256(workspace + '/roundtrip')) throw new Error('Compressed cache roundtrip changed bytes.');
        io.progress('Saving the verified boot cache (4 of 6 stages complete).',400/6);
        if (profile !== 'stock') io.copyAlert(catalog.alert, root + 'noloadkextalert.plist');
        io.publish(workspace + '/compressed', root + 'kernelcache');
        io.assertPrivateStage();
        io.progress('Recording boot cache checksums (5 of 6 stages complete).',500/6);
        var receipt = {kind: 'mavericks-cache-preparation', completed: true, profile: profile, selection: selected.selection,
            candidate: candidate, bundleCount: count, kernelcacheSHA256: io.sha256(root + 'kernelcache'),
            uncompressedSHA256: io.sha256(workspace + '/uncompressed'), informationCaches: {}};
        infoFiles.forEach(function (file) { receipt.informationCaches[file] = io.sha256(file); });
        io.complete(workspace, receipt);
        io.progress('All 6 boot cache stages complete.',100);
        return receipt;
    }
    return {plan: plan, argumentsFor: argumentsFor, verifyRows: verifyRows, prepare: prepare};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionCachePreparation;
