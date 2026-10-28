/* Apply exact released model repairs to a NEW private staged OS only.
 * Existing-volume NVMe maintenance uses its separate transaction controller.
 */
var MavericksModelPatches = (function () {
    'use strict';
    var plans = typeof MavericksPatchPlan !== 'undefined' ? MavericksPatchPlan : require('./PatchPlan.js');
    function relative(path, allowRoot) {
        return typeof path === 'string' && (allowRoot && path === '' ||
            path.length > 0 && !/[\\\x00-\x1f\x7f]/.test(path) &&
            !path.split('/').some(function (part) { return !part || part === '.' || part === '..'; }));
    }
    function normalize(parts) {
        var result = [];
        parts.forEach(function (part) {
            if (!part || part === '.') return;
            if (part === '..') { if (!result.length) throw new Error('Payload link escapes its component.'); result.pop(); }
            else result.push(part);
        });
        return result;
    }
    function entriesCheck(entries, includeRoot) {
        if (!Array.isArray(entries) || !entries.length) throw new Error('Payload tree is missing.');
        var byPath = Object.create(null);
        entries.forEach(function (entry) {
            if (!entry || !relative(entry.path, includeRoot) || Object.prototype.hasOwnProperty.call(byPath, entry.path) ||
                ['file', 'directory', 'symlink'].indexOf(entry.kind) < 0 ||
                typeof entry.mode !== 'number' || entry.mode < 0 || entry.mode > 4095 || Math.floor(entry.mode) !== entry.mode ||
                typeof entry.uid !== 'number' || !isFinite(entry.uid) || entry.uid < 0 || Math.floor(entry.uid) !== entry.uid ||
                typeof entry.gid !== 'number' || !isFinite(entry.gid) || entry.gid < 0 || Math.floor(entry.gid) !== entry.gid) throw new Error('Invalid payload entry.');
            if (entry.kind === 'file' && (!/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.bytes !== 'number' ||
                !isFinite(entry.bytes) || entry.bytes < 0 || Math.floor(entry.bytes) !== entry.bytes)) throw new Error('Invalid payload file identity.');
            if (entry.kind === 'symlink' && (typeof entry.link !== 'string' || !entry.link.length || entry.link.charAt(0) === '/' || /[\\\x00-\x1f\x7f]/.test(entry.link))) throw new Error('Unsafe payload link.');
            byPath[entry.path] = entry;
        });
        if (includeRoot && !byPath['']) throw new Error('Component root is missing.');
        entries.forEach(function (entry) {
            var parts = entry.path.split('/');
            for (var i = 1; i < parts.length; i++) {
                var parent = byPath[parts.slice(0, i).join('/')];
                if (!parent || parent.kind !== 'directory') throw new Error('Payload parent is missing or a link.');
            }
            if (entry.kind !== 'symlink') return;
            var destination = normalize(parts.slice(0, -1).concat(entry.link.split('/'))), visited = Object.create(null);
            // Resolve link ancestors too, without touching the filesystem.
            for (var step = 0; step <= entries.length; step++) {
                var redirected = false;
                for (var count = 1; count <= destination.length; count++) {
                    var prefix = destination.slice(0, count).join('/'), link = byPath[prefix];
                    if (link && link.kind === 'symlink') {
                        if (visited[prefix]) throw new Error('Payload contains a link cycle.');
                        visited[prefix] = true;
                        destination = normalize(destination.slice(0, count - 1).concat(link.link.split('/'), destination.slice(count)));
                        redirected = true; break;
                    }
                }
                if (!redirected) return;
            }
            throw new Error('Payload link resolution did not finish.');
        });
        return entries;
    }
    function catalogCheck(catalog) {
        if (!catalog || catalog.schema !== 1 || catalog.archive !== 'Released-Model-Support.tar.gz' ||
            catalog.sourceArchiveSHA256 !== '9029738b0ce13d185e3edb7c91ce43d8ecc895a28aa15313ac859437d93e359c' ||
            !/^[a-f0-9]{64}$/.test(catalog.archiveSHA256) || typeof catalog.archiveBytes !== 'number' || !isFinite(catalog.archiveBytes) || catalog.archiveBytes <= 0 ||
            !Array.isArray(catalog.components)) throw new Error('Invalid released model payload.');
        entriesCheck(catalog.archiveEntries, false);
        var expected = plans.plan('MacBookPro11,5', 'Mac-06F11F11946D27C5', 'direct').installedPaths;
        if (catalog.components.length !== expected.length) throw new Error('Released component count differs.');
        catalog.components.forEach(function (component, i) {
            if (component.source !== expected[i].source || component.target !== expected[i].target) throw new Error('Released component destination differs.');
            entriesCheck(component.entries, true);
            component.entries.forEach(function (e) { if (e.uid !== 0 || e.gid !== 0) throw new Error('Installed repairs must be owned by root:wheel.'); });
        });
    }
    function apply(io, stage, model, board, catalog) {
        var plan = plans.plan(model, board, 'direct');
        io.assertInstalledStage(stage);
        if (plan.profile === 'stock') return {kind: 'mavericks-model-patches', completed: true, profile: 'stock', components: []};
        catalogCheck(catalog);
        var payload = io.prepareModelPayload(stage, catalog), installed = [];
        plan.installedPaths.forEach(function (selected,index) {
            var component = catalog.components.filter(function (c) { return c.source === selected.source && c.target === selected.target; })[0];
            if (!component) throw new Error('Released component is missing.');
            io.progress('model-patches', 'Installing ' + component.target,index*100/plan.installedPaths.length);
            io.replaceModelComponent(stage, payload, component);
            installed.push(component.target);
            io.progress('model-patches','Applied '+installed.length+' of '+plan.installedPaths.length+' compatibility components.',installed.length*100/plan.installedPaths.length);
        });
        io.assertInstalledStage(stage);
        return {kind: 'mavericks-model-patches', completed: true, profile: plan.profile,
            sourceArchiveSHA256: catalog.sourceArchiveSHA256, components: installed};
    }
    return {entriesCheck: entriesCheck, catalogCheck: catalogCheck, apply: apply};
}());
if (typeof module !== 'undefined') module.exports = MavericksModelPatches;
