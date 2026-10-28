/* Select precisely the original BaseSystemResources BOM paths from the pinned
 * stock BaseSystem. Modern PackageKit otherwise copies its entire external root. */
var MavericksResurrectionBaseResources = (function () {
    'use strict';
    var manifests = typeof MavericksResurrectionTreeManifest !== 'undefined' ? MavericksResurrectionTreeManifest : require('./TreeManifest.js');
    function selection(bomText, source, catalog) {
        if (!catalog || catalog.schema !== 1 || catalog.bomSHA256 !== '707b098d189b762c260b66ee40c50bf3de64f5c89720c97c660a43bbc5b3bce0' ||
            catalog.baseSystemSHA256 !== '4e33ed34db869189bec60dc2334573e5d5e420037fc18e7f0f4b1251a396ad6d' ||
            catalog.bomEntries !== 46769 || catalog.availableEntries !== 46630 || !Array.isArray(catalog.absentPaths) || catalog.absentPaths.length !== 139) throw new Error('Unexpected BaseSystemResources selection catalog.');
        var rows = manifests.validate(source).rows, byPath = Object.create(null), wanted = Object.create(null), absent = [];
        rows.forEach(function (r) { byPath[r.path] = r; });
        var names = bomText.replace(/\n$/, '').split('\n').map(function (line) {
            if (line === '.') return '';
            if (line.indexOf('./') !== 0 || line.slice(2).split('/').some(function (p) { return !p || p === '.' || p === '..'; }) || /[\x00-\x1f\x7f]/.test(line)) throw new Error('Unsafe BOM entry.');
            return line.slice(2);
        });
        if (names.length !== catalog.bomEntries) throw new Error('BOM member count differs.');
        names.forEach(function (p) {
            if (wanted[p]) throw new Error('Duplicate BOM entry.');
            wanted[p] = true;
            if (!byPath[p]) absent.push(p);
        });
        if (JSON.stringify(absent.sort()) !== JSON.stringify(catalog.absentPaths.slice().sort())) throw new Error('Unexpected missing stock resource.');
        var selected = rows.filter(function (r) { return wanted[r.path]; }).map(function (r) { return JSON.parse(JSON.stringify(r)); });
        if (selected.length !== catalog.availableEntries) throw new Error('Available resource member count differs.');
        var groups = Object.create(null);
        selected.forEach(function (r) { if (r.hardlinkTo !== undefined) (groups[r.hardlinkTo] || (groups[r.hardlinkTo] = [])).push(r); });
        Object.keys(groups).forEach(function (key) {
            var members = groups[key];
            members.forEach(function (r) { if (members.length === 1) delete r.hardlinkTo; else r.hardlinkTo = members[0].path; });
        });
        var result = selected.concat([{type: 'complete', schema: 1, entries: selected.length,
            logicalFileBytes: selected.reduce(function (n, r) { return n + (r.kind === 'file' ? r.bytes : 0); }, 0)}]);
        manifests.validate(result);
        return result;
    }
    return {selection: selection};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionBaseResources;
