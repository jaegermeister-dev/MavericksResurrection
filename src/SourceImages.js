/* Image preparation shared by the native worker and failure-injection tests.
 * Only app-owned image files are changed. No target disk operation belongs here.
 */
var MavericksSourceImages = (function () {
    'use strict';
    var packagePrefix = 'System/Installation/Packages/';
    function validateManifest(manifest) {
        if (!manifest || manifest.version !== '10.9.5' || manifest.build !== '13F34' ||
            !Array.isArray(manifest.files) || manifest.files.length !== 23) throw new Error('Invalid Mavericks source manifest.');
        var seen = {};
        manifest.files.forEach(function (entry) {
            if (!entry || typeof entry.path !== 'string' || !entry.path.length ||
                entry.path.charAt(0) === '/' || /[\\\x00-\x1f\x7f]/.test(entry.path) ||
                entry.path.split('/').some(function (p) { return !p || p === '.' || p === '..'; }) ||
                seen[entry.path] || !/^[0-9a-f]{64}$/.test(entry.sha256) ||
                typeof entry.bytes !== 'number' || !isFinite(entry.bytes) || entry.bytes < 1 || entry.bytes > 9007199254740991 || entry.bytes % 1) {
                throw new Error('Invalid source manifest entry.');
            }
            seen[entry.path] = true;
        });
        if (manifest.files.filter(function (e) { return e.path.indexOf(packagePrefix) === 0; }).length !== 16 ||
            !seen['System/Installation/BaseSystem.dmg'] || !seen['System/Installation/BaseSystem.chunklist']) {
            throw new Error('Incomplete package or BaseSystem manifest.');
        }
        return manifest;
    }
    function sameFile(a, b) {
        return a && b && a.kind === 'file' && b.kind === 'file' &&
            a.identity === b.identity && a.bytes === b.bytes && a.modified === b.modified;
    }
    function withMount(io, image, job, label, writable, action) {
        var mount = io.attach(image, job, label, writable), result, failure;
        try { result = action(mount.root, mount); }
        catch (error) { failure = error; }
        try { io.detach(mount); }
        catch (error) {
            throw new Error((failure ? String(failure) + '\n' : '') +
                'Could not detach this app-owned image: ' + mount.root + '. ' + String(error));
        }
        if (failure) throw failure;
        return result;
    }
    function checkFiles(io, root, entries, mount) {
        var verified = {}, imageIdentity = mount ? io.stat(mount.image) : null;
        entries.forEach(function (entry, index) {
            io.progress('verify', 'Checking ' + (index + 1) + '/' + entries.length + ': ' + entry.path, index * 100 / entries.length);
            // The adapter must reject symbolic links in every path component.
            var file = io.regularWithin(root, entry.path);
            if (file.bytes !== entry.bytes || io.sha256(root + '/' + entry.path) !== entry.sha256) {
                throw new Error('Mavericks source differs: ' + entry.path);
            }
            if (!sameFile(file, io.regularWithin(root, entry.path))) throw new Error('Mavericks source changed during verification: ' + entry.path);
            verified[root + '/' + entry.path] = {file: file, relative: entry.path, sha256: entry.sha256};
            io.progress('verify', 'Checked ' + (index + 1) + ' of ' + entries.length + ' files.', (index + 1) * 100 / entries.length);
        });
        // Valid only within the caller's still-attached read-only source mount.
        // Package preparation checks mount ownership before using this proof.
        // Never serialize it or reuse it across installation runs.
        return function (path, bytes, digest) {
            var entry = verified[path];
            if (!mount || mount.root !== root || mount.writable || !sameFile(imageIdentity, io.stat(mount.image)) ||
                !entry || entry.file.bytes !== bytes || entry.sha256 !== digest ||
                !sameFile(entry.file, io.regularWithin(root, entry.relative))) {
                throw new Error('Previously verified Mavericks source changed: ' + path);
            }
        };
    }
    function checkLayout(io, root, entries) {
        entries.forEach(function (entry) {
            if (io.regularWithin(root, entry.path).bytes !== entry.bytes) throw new Error('Mavericks source size differs: ' + entry.path);
        });
    }
    function checkPackageNames(io, root, entries) {
        var expected = entries.filter(function (e) { return e.path.indexOf(packagePrefix) === 0; })
            .map(function (e) { return e.path.slice(packagePrefix.length); }).sort();
        var names = io.directoryNames(root + '/System/Installation/Packages').sort();
        if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('The installer package directory contains unexpected or missing entries.');
    }
    function inspect(io, image, parent, manifest) {
        validateManifest(manifest);
        image = io.canonicalFile(image);
        var before = io.stat(image), job = io.createJob(parent, 'inspect');
        var result = withMount(io, image, job, 'source', false, function (root) {
            checkPackageNames(io, root, manifest.files);
            checkLayout(io, root, manifest.files);
            return {kind: 'verified-mavericks-inputs', version: manifest.version, build: manifest.build,
                image: image, inputs: manifest.files, job: job};
        });
        if (!sameFile(before, io.stat(image))) throw new Error('The selected image changed during inspection. Select it again.');
        result.imageIdentity = before;
        io.writeReceipt(job, result);
        return result;
    }
    function freeze(io, image, parent, manifest) {
        validateManifest(manifest);
        image = io.canonicalFile(image);
        var before = io.stat(image), job = io.createJob(parent, 'inputs');
        io.ensureFree(job, 6 * 1024 * 1024 * 1024);
        var frozen = io.makeDirectory(job, 'verified-inputs');
        withMount(io, image, job, 'source', false, function (root) {
            checkPackageNames(io, root, manifest.files);
            // Copy first, then verify every consumed byte in the private workspace.
            // Later staging uses these copies, never an unchecked caller DMG path.
            manifest.files.forEach(function (entry,index) {
                io.progress('freeze','Copying source file '+(index+1)+' of '+manifest.files.length+': '+entry.path,index*100/manifest.files.length);
                var file = io.regularWithin(root, entry.path);
                if (file.bytes !== entry.bytes) throw new Error('Source input size differs: ' + entry.path);
                io.copyFile(root + '/' + entry.path, frozen, entry.path);
                io.progress('freeze','Copied '+(index+1)+' of '+manifest.files.length+' source files.',(index+1)*100/manifest.files.length);
            });
        });
        if (!sameFile(before, io.stat(image))) throw new Error('The selected image changed while being copied.');
        checkFiles(io, frozen, manifest.files);
        var result = {kind: 'frozen-mavericks-inputs', version: manifest.version, build: manifest.build,
            job: job, root: frozen, image: image, inputs: manifest.files,
            packages: frozen + '/System/Installation/Packages',
            baseSystem: frozen + '/System/Installation/BaseSystem.dmg'};
        io.writeReceipt(job, result);
        return result;
    }
    function esdEntries(manifest) {
        return manifest.files.filter(function (e) { return e.path.indexOf('System/Installation/') === 0; })
            .map(function (e) { return {path: e.path.slice('System/Installation/'.length), bytes: e.bytes, sha256: e.sha256}; });
    }
    function build(io, parent, manifest) {
        validateManifest(manifest);
        if (!/^[0-9a-f]{64}$/.test(manifest.installESDSHA256)) throw new Error('Missing InstallESD checksum.');
        var job = io.createJob(parent, 'MavericksForever');
        io.ensureFree(job, 20 * 1024 * 1024 * 1024);
        io.progress('download', 'Downloading Mavericks with MavericksForever by Wowfunhappy.');
        var esd = io.downloadMavericksForever(job);
        io.progress('verify-download', 'Verifying the downloaded Mavericks image.');
        if (io.sha256(esd) !== manifest.installESDSHA256) throw new Error('Downloaded InstallESD checksum differs.');
        var sparse = job + '/InstallMacOSXMavericks.sparseimage';
        var output = job + '/InstallMacOSXMavericks.dmg';
        withMount(io, esd, job, 'esd', false, function (esdRoot) {
            checkLayout(io, esdRoot, esdEntries(manifest));
            io.progress('build', 'Building the complete Mavericks installer image.');
            io.convertImage(esdRoot + '/BaseSystem.dmg', sparse, 'UDSP', job);
            io.progress('build', 'Making room for Mavericks packages in the private image.');
            io.resizeImage(sparse, 8 * 1024 * 1024 * 1024, job);
            withMount(io, sparse, job, 'build', true, function (root) {
                io.removePackageLink(root);
                io.progress('build-copy', 'Installer image: copying package folder (0 of 3 copy steps complete).', 0);
                io.copyDirectory(esdRoot + '/Packages', root, 'System/Installation/Packages');
                io.progress('build-copy', 'Installer image: package folder copied; copying Base System (1 of 3 steps complete).', 100 / 3);
                io.copyFile(esdRoot + '/BaseSystem.dmg', root, 'System/Installation/BaseSystem.dmg');
                io.progress('build-copy', 'Installer image: Base System copied; copying its checksum list (2 of 3 steps complete).', 200 / 3);
                io.copyFile(esdRoot + '/BaseSystem.chunklist', root, 'System/Installation/BaseSystem.chunklist');
                io.progress('build-copy', 'Installer image: all 3 copy steps complete.', 100);
                checkPackageNames(io, root, manifest.files);
                checkLayout(io, root, manifest.files);
            });
        });
        io.convertImage(sparse, output, 'UDZO', job);
        io.progress('verify-image', 'Opening the finished installer image for verification.');
        withMount(io, output, job, 'result', false, function (root) {
            checkPackageNames(io, root, manifest.files);
            checkFiles(io, root, manifest.files);
        });
        io.progress('verify-image', 'Installer image created. Choose whether to save a checksum next.',100);
        var result = {kind: 'built-mavericksforever-image', version: manifest.version, build: manifest.build,
            job: job, image: output, imageSHA256: null,
            attribution: manifest.mavericksForever, inputs: manifest.files};
        io.writeReceipt(job, result);
        // Only intermediates in this newly created job are eligible for cleanup.
        // A cleanup failure must preserve the verified final image and be reported.
        [esd, sparse].forEach(function (path) {
            try { io.removeIntermediate(path, job); }
            catch (error) { io.progress('warning', 'Image ready; retained intermediate ' + path + ': ' + String(error)); }
        });
        return result;
    }
    return {validateManifest: validateManifest, inspect: inspect, freeze: freeze, build: build,
        checkFiles: checkFiles, withMount: withMount};
}());
if (typeof module !== 'undefined') module.exports = MavericksSourceImages;
