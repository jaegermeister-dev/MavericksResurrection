/* Optional initial drivers for a newly created image; physical maintenance is separate. */
var MavericksResurrectionNVMeStage = (function () {
    'use strict';
    var policy = typeof MavericksNVMePolicy !== 'undefined' ? MavericksNVMePolicy : require('./NVMePolicy');
    var model = typeof MavericksModelPatches !== 'undefined' ? MavericksModelPatches : require('./ModelPatches');
    var slots = ['System/Library/Extensions/IONVMeFamily.kext', 'System/Library/Extensions/NVMeGeneric.kext'];
    function check(catalog, payload) {
        if (!payload || payload.schema !== 1 || payload.archive !== catalog.payloadArchive ||
            payload.archiveSHA256 !== catalog.payloadArchiveSHA256 || !/^[a-f0-9]{64}$/.test(payload.archiveSHA256) ||
            typeof payload.archiveBytes !== 'number' || payload.archiveBytes <= 0 || !isFinite(payload.archiveBytes) ||
            !Array.isArray(payload.components) || payload.components.length !== 1) throw new Error('Invalid NVMe payload inventory.');
        model.entriesCheck(payload.archiveEntries, false);
        var expectedFiles = Object.create(null);
        catalog.candidates.forEach(function (c) { policy.candidate(catalog, c.id).drivers.forEach(function (d) {
            Object.keys(d.files).forEach(function (p) {
                if (p.indexOf(d.path + '/') !== 0 || (expectedFiles[p] && expectedFiles[p] !== d.files[p])) throw new Error('Conflicting NVMe file inventory.');
                expectedFiles[p] = d.files[p];
            });
        }); });
        var actualFiles = payload.archiveEntries.filter(function (e) { return e.kind === 'file'; });
        if (actualFiles.length !== Object.keys(expectedFiles).length) throw new Error('NVMe archive file list differs.');
        actualFiles.forEach(function (e) { if (expectedFiles[e.path] !== e.sha256) throw new Error('NVMe archive file checksum differs.'); });
        payload.archiveEntries.forEach(function (e) {
            if (e.kind !== 'file' && e.kind !== 'directory') throw new Error('NVMe payload links are not permitted.');
            if (e.uid !== 0 || e.gid !== 0 || e.mode !== (e.kind === 'directory' || /\/Contents\/MacOS\//.test(e.path) ? 493 : 420)) throw new Error('Unexpected NVMe payload permissions.');
        });
        payload.components.forEach(function (c, i) {
            if (c.source !== slots[i] || c.target !== slots[i]) throw new Error('Unexpected NVMe component destination.');
            model.entriesCheck(c.entries, true);
            var expected = payload.archiveEntries.filter(function (e) { return e.path === c.source || e.path.indexOf(c.source + '/') === 0; })
                .map(function (e) { var result = JSON.parse(JSON.stringify(e)); result.path = e.path.slice(c.source.length).replace(/^\//, ''); return result; });
            if (JSON.stringify(c.entries) !== JSON.stringify(expected)) throw new Error('NVMe component metadata differs from the archive.');
        });
    }
    function apply(io, stage, key, catalog, payload) {
        io.assertInstalledStage(stage);
        // The original state of these slots in the verified fresh OS is absent.
        // Existing content is never overwritten or guessed to belong to this app.
        slots.forEach(function (slot) { io.assertAbsentStagePath(stage, slot); });
        if (key === null) return {kind: 'mavericks-initial-nvme', completed: true, candidate: null, drivers: []};
        var candidate = policy.candidate(catalog, key);
        check(catalog, payload);
        var prepared = io.prepareNVMePayload(stage, payload), selected = [];
        candidate.drivers.forEach(function (driver) {
            var component = payload.components.filter(function (c) { return c.target === driver.path; })[0];
            if (!component || component.bundleID !== driver.bundleID || component.bundleVersion !== driver.bundleVersion) throw new Error('Selected NVMe driver identity differs.');
            io.installFreshNVMeComponent(stage, prepared, component);
            selected.push(component.target);
        });
        slots.filter(function (slot) { return selected.indexOf(slot) < 0; }).forEach(function (slot) { io.assertAbsentStagePath(stage, slot); });
        var state = io.writeInitialNVMeState(stage, {schema: 1, origin: 'mavericksresurrection-fresh-install',
            baseline: slots.map(function (path) { return {path: path, kind: 'absent'}; }),
            activeCandidate: candidate.id, candidateRevision: candidate.revision, drivers: candidate.drivers,
            payloadArchiveSHA256: payload.archiveSHA256});
        return {kind: 'mavericks-initial-nvme', completed: true, candidate: candidate.id, drivers: selected, state: state};
    }
    return {check: check, apply: apply};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionNVMeStage;
