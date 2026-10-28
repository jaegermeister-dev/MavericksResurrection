/* macOS Foundation adapter for private image and package preparation.
 * Source operations run as the user; installation into newly created private
 * images requires the separate root stage worker. No physical disk mutation.
 * Native execution still requires validation on an authorized Mac.
 */
var MavericksMacSourceIO = (function () {
    'use strict';
    ObjC.import('Foundation');
    function create(progress, resourceRoot, isCancelled, cancelFile, diagnostic) {
        var fm = $.NSFileManager.defaultManager, jobs = {}, mounts = {}, writableRoots = {}, systemImages = {}, modelPayloads = {}, nvmePayloads = {}, unpackedNVMe = {}, externalRoots = {}, freshDestinations = {};
        isCancelled = isCancelled || function () { return false; };
        function report(event, detail) { try { if (diagnostic) diagnostic(event, detail); } catch (_) {} }
        function checkCancellation() { if (isCancelled()) throw new Error('Image preparation cancelled. Retained downloads and image evidence are in the workspace.'); }
        var notify = progress;
        progress = function (phase, message, percent) { checkCancellation(); notify(phase, message, percent); };
        var tools = {
            '/usr/bin/hdiutil': true, '/usr/sbin/diskutil': true,
            '/usr/bin/shasum': true, '/usr/bin/mktemp': true,
            '/usr/bin/ditto': true, '/bin/bash': true, '/usr/bin/xar': true,
            '/usr/sbin/installer': true, '/usr/sbin/pkgutil': true,
            '/usr/bin/tar': true, '/usr/sbin/chown': true,
            '/usr/sbin/sysctl': true, '/usr/sbin/ioreg': true, '/usr/bin/lsbom': true
        };
        function fail(error, fallback) {
            // Dereferencing autoreleased NSError pointers through JXA Ref can
            // crash Tahoe's bridge. The operation and paths are logged separately.
            throw new Error(fallback);
        }
        function decode(data) {
            var value = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
            if (!value || value.isNil()) throw new Error('A command returned invalid text.');
            return ObjC.unwrap(value);
        }
        function run(executable, args, stream, cwd) {
            if (!tools[executable] || !Array.isArray(args)) throw new Error('Unexpected source tool.');
            // Cleanup identification and detach must remain possible after Cancel.
            var cleanup = (executable === '/usr/bin/hdiutil' && (args[0] === 'info' || args[0] === 'detach')) ||
                (executable === '/usr/sbin/diskutil' && args[0] === 'info');
            if (!cleanup) checkCancellation();
            args.forEach(function (arg) { if (typeof arg !== 'string' || /\x00/.test(arg)) throw new Error('Invalid command argument.'); });
            report('command.started', {program: executable, arguments: args, workingDirectory: cwd || null});
            var task = $.NSTask.alloc.init, pipe = $.NSPipe.pipe;
            task.launchPath = $(executable);
            task.arguments = $(args);
            if (cwd) task.currentDirectoryPath = $(canonical(cwd, 'directory'));
            task.environment = $({PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C',
                HOME: ObjC.unwrap($.NSHomeDirectory())});
            task.standardInput = $.NSFileHandle.fileHandleForReadingAtPath('/dev/null');
            task.standardOutput = pipe;
            task.standardError = pipe;
            task.launch;
            var data;
            try {
                if (stream) {
                    data = $.NSMutableData.data;
                    while (true) {
                        var chunk = pipe.fileHandleForReading.availableData;
                        if (!Number(chunk.length)) break;
                        // The downloader checks a cancellation marker and terminates
                        // its own curl child; image tools finish their current command.
                        stream(decode(chunk));
                        if (Number(data.length) > 65536) data = $.NSMutableData.data;
                        data.appendData(chunk);
                    }
                } else data = pipe.fileHandleForReading.readDataToEndOfFile;
            } catch (error) {
                if (Boolean(task.running)) task.terminate;
                task.waitUntilExit;
                throw error;
            }
            task.waitUntilExit;
            var length = Number(data.length), commandOutput = null;
            // The large tree manifests have their own verification artifacts;
            // copying them into a support log would obscure useful diagnostics.
            if (length <= 262144) { try { commandOutput = decode(data); } catch (_) {} }
            report('command.finished', {program: executable, status: Number(task.terminationStatus),
                outputBytes: length, output: commandOutput, streamed: !!stream});
            if (Number(task.terminationStatus) !== 0) throw new Error(executable + ' failed: ' + decode(data));
            return data;
        }
        function plist(executable, args) {
            var error = Ref(), data = run(executable, args);
            var value = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, error);
            if (!value || value.isNil()) fail(error, 'Could not read a property list.');
            return ObjC.deepUnwrap(value);
        }
        function absolute(path) {
            if (typeof path !== 'string' || path.charAt(0) !== '/' || /[\x00-\x1f\x7f]/.test(path)) throw new Error('Choose an absolute path without control characters.');
            return path;
        }
        function stat(path) {
            absolute(path);
            var error = Ref(), a = fm.attributesOfItemAtPathError($(path), error);
            if (!a || a.isNil()) fail(error, 'Cannot inspect ' + path);
            var type = ObjC.unwrap(a.objectForKey($.NSFileType));
            return {kind: type === 'NSFileTypeRegular' ? 'file' : type === 'NSFileTypeDirectory' ? 'directory' :
                type === 'NSFileTypeSymbolicLink' ? 'symlink' : 'other',
                bytes: Number(ObjC.unwrap(a.objectForKey($.NSFileSize))),
                mode: Number(ObjC.unwrap(a.objectForKey($.NSFilePosixPermissions))),
                uid: Number(ObjC.unwrap(a.objectForKey($.NSFileOwnerAccountID))),
                gid: Number(ObjC.unwrap(a.objectForKey($.NSFileGroupOwnerAccountID))),
                identity: String(ObjC.unwrap(a.objectForKey($.NSFileSystemNumber))) + ':' +
                    String(ObjC.unwrap(a.objectForKey($.NSFileSystemFileNumber))),
                modified: Number(a.objectForKey($.NSFileModificationDate).timeIntervalSince1970)};
        }
        function exists(path) {
            // fileExistsAtPath follows links, so also check the parent listing for broken links.
            if (fm.fileExistsAtPath($(path))) return true;
            var parent = path.slice(0, path.lastIndexOf('/')) || '/', name = path.slice(path.lastIndexOf('/') + 1);
            try { return directoryNames(parent).indexOf(name) >= 0; } catch (_) { return false; }
        }
        function canonical(path, kind) {
            absolute(path);
            if (stat(path).kind !== kind) throw new Error('Expected a regular ' + kind + ': ' + path);
            var result = ObjC.unwrap($(path).stringByStandardizingPath.stringByResolvingSymlinksInPath);
            if (stat(result).kind !== kind) throw new Error('The path changed while being inspected.');
            return result;
        }
        function relative(path) {
            if (typeof path !== 'string' || !path.length || /[\\\x00-\x1f\x7f]/.test(path) ||
                path.split('/').some(function (part) { return !part || part === '.' || part === '..'; })) throw new Error('Unsafe relative path.');
            return path;
        }
        function noLinks(root, rel, finalKind) {
            var path = root;
            relative(rel).split('/').forEach(function (part, index, all) {
                path += '/' + part;
                var info = stat(path);
                if (info.kind !== (index === all.length - 1 ? finalKind : 'directory')) throw new Error('Unexpected file type or symbolic link: ' + path);
            });
            return stat(path);
        }
        function mkdir(path) {
            var error = Ref();
            if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(path), true, $({NSFilePosixPermissions: 448}), error)) fail(error, 'Cannot create ' + path);
        }
        function writeText(path, text) {
            var error = Ref();
            if (!$(text).writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, error)) fail(error, 'Cannot write ' + path);
        }
        function readJSON(path) {
            var error = Ref(), text = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, error);
            if (!text || text.isNil()) fail(error, 'Cannot read ' + path);
            return JSON.parse(ObjC.unwrap(text));
        }
        function readText(path) {
            path = canonical(path, 'file');
            var error = Ref(), text = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, error);
            if (!text || text.isNil()) fail(error, 'Cannot read ' + path);
            return ObjC.unwrap(text);
        }
        function ownedJob(job) {
            if (!jobs[job] || canonical(job, 'directory') !== job ||
                readJSON(job + '/.mavericks-source-job').token !== jobs[job]) throw new Error('App job ownership changed.');
            return job;
        }
        function ownedFile(path, job) {
            ownedJob(job);
            if (path.indexOf(job + '/') !== 0) throw new Error('Image path is outside its app job.');
            return noLinks(job, path.slice(job.length + 1), 'file');
        }
        function createJob(parent, kind) {
            parent = canonical(parent, 'directory');
            if (!/^[A-Za-z-]+$/.test(kind)) throw new Error('Invalid job kind.');
            var job = decode(run('/usr/bin/mktemp', ['-d', parent + '/Mavericks-App-' + kind + '-XXXXXXXX'])).trim();
            if (job.indexOf(parent + '/') !== 0 || canonical(job, 'directory') !== job) throw new Error('Unexpected app job directory.');
            jobs[job] = ObjC.unwrap($.NSUUID.UUID.UUIDString);
            writeText(job + '/.mavericks-source-job', JSON.stringify({schema: 1, token: jobs[job], kind: kind}) + '\n');
            return job;
        }
        function matchedMount(record) {
            var inventory = plist('/usr/bin/hdiutil', ['info', '-plist']), found = [];
            (inventory.images || []).forEach(function (image) {
                if (image['image-path'] !== record.image) return;
                (image['system-entities'] || []).forEach(function (entity) {
                    if (entity['mount-point'] === record.root && /^\/dev\/disk[0-9]+(s[0-9]+)*$/.test(entity['dev-entry'] || '')) {
                        found.push(entity['dev-entry']);
                    }
                });
            });
            if (found.length !== 1) throw new Error('The app image mount could not be identified uniquely: ' + record.root);
            return found[0];
        }
        var mountProofs = {};
        function assertMount(record, refresh) {
            if (matchedMount(record) !== record.device) throw new Error('Image mount identity changed.');
            var rootIdentity = stat(record.root).identity, imageIdentity = stat(record.image).identity;
            var proof = mountProofs[record.root];
            if (proof && (proof.record !== record || proof.rootIdentity !== rootIdentity ||
                proof.imageIdentity !== imageIdentity || proof.device !== record.device ||
                proof.writable !== record.writable)) throw new Error('Image mount identity changed.');
            // The private mount is still checked above on every operation.
            // Query diskutil afresh only when binding or revalidating a phase.
            if (proof && !refresh) return;
            var info = plist('/usr/sbin/diskutil', ['info', '-plist', record.root]);
            if (info.DeviceNode !== record.device || info.FilesystemType !== 'hfs' ||
                (record.writable ? info.WritableVolume !== true : info.WritableVolume !== false)) throw new Error('Image mount format or access mode differs.');
            mountProofs[record.root] = {record:record, rootIdentity:rootIdentity,
                imageIdentity:imageIdentity, device:record.device, writable:record.writable};
        }
        function attach(image, job, label, writable, enforceOwners) {
            ownedJob(job);
            image = canonical(image, 'file');
            if (!/^[a-z]+$/.test(label)) throw new Error('Invalid image mount label.');
            if (writable) {
                ownedFile(image, job);
                if (!/\.sparseimage$/.test(image)) throw new Error('Only an app-created sparse image may be mounted writable.');
            }
            var root = job + '/mount-' + label;
            if (exists(root)) throw new Error('Image mount directory already exists.');
            mkdir(root);
            var record = {image: image, root: root, job: job, writable: !!writable, enforceOwners: !!enforceOwners, device: ''};
            writeText(job + '/mount-' + label + '.json', JSON.stringify(record) + '\n');
            try {
                run('/usr/bin/hdiutil', ['attach', '-plist', writable ? '-readwrite' : '-readonly',
                    '-owners', writable && !enforceOwners ? 'off' : 'on', '-nobrowse', '-mountpoint', root, image]);
                record.device = matchedMount(record);
                assertMount(record);
            } catch (error) {
                // A failed attach can still leave a mounted image. Only this exact
                // image+mountpoint may be detached, never a shared volume name.
                try {
                    var partialDevice = matchedMount(record);
                    run('/usr/bin/hdiutil', ['detach', partialDevice]);
                } catch (cleanupError) {
                    throw new Error(String(error) + '\nInspect retained image-mount evidence in ' + job + ': ' + String(cleanupError));
                }
                throw error;
            }
            mounts[root] = record;
            if (writable) writableRoots[root] = record;
            writeText(job + '/mount-' + label + '.json', JSON.stringify(record) + '\n');
            return record;
        }
        function detach(record) {
            if (mounts[record.root] !== record) throw new Error('Unowned image mount.');
            assertMount(record, true);
            run('/usr/bin/hdiutil', ['detach', record.device]);
            delete mountProofs[record.root];
            delete writableRoots[record.root];
            delete mounts[record.root];
        }
        function writeRoot(root) {
            if (writableRoots[root]) { assertMount(writableRoots[root]); return; }
            var found = Object.keys(jobs).filter(function (job) { return root === job || root.indexOf(job + '/') === 0; });
            if (found.length !== 1) throw new Error('Destination is not app-owned.');
            ownedJob(found[0]);
            if (root !== found[0]) noLinks(found[0], root.slice(found[0].length + 1), 'directory');
        }
        function destination(root, rel) {
            writeRoot(root); relative(rel);
            var parts = rel.split('/'), current = root;
            parts.slice(0, -1).forEach(function (part) {
                current += '/' + part;
                if (!exists(current)) mkdir(current);
                if (stat(current).kind !== 'directory') throw new Error('Destination parent is a symbolic link or non-directory.');
            });
            var path = root + '/' + rel;
            if (exists(path)) throw new Error('Refusing to overwrite an existing image input: ' + path);
            return path;
        }
        function directoryNames(path) {
            var error = Ref(), names = fm.contentsOfDirectoryAtPathError($(path), error);
            if (!names || names.isNil()) fail(error, 'Cannot read directory ' + path);
            return ObjC.deepUnwrap(names);
        }
        function sha256(path) {
            path = canonical(path, 'file');
            if(stat(path).bytes>=64*1024*1024)return hashImage(path,'verify-bytes');
            var output = decode(run('/usr/bin/shasum', ['-a', '256', path])), match = output.match(/^([a-f0-9]{64})\s/);
            if (!match) throw new Error('SHA-256 output was not recognized.');
            return match[1];
        }
        function hashImage(path,phase){
            path=canonical(path,'file');phase=phase||'hash-image';
            var helper=canonical(resourceRoot+'/../BundledTools/HashFile','file'),catalog=readJSON(resourceRoot+'/../assets/NativeTools.json').tools.HashFile;
            if(!catalog||stat(helper).bytes!==catalog.bytes||sha256(helper)!==catalog.sha256)throw new Error('Checksum helper differs.');
            var pending='',digest=null;tools[helper]=true;
            function lines(text){pending+=text;var all=pending.split('\n');pending=all.pop();all.forEach(function(line){if(!line)return;var v=JSON.parse(line);if(typeof v.percent==='number')progress(phase,'Checking '+path.slice(path.lastIndexOf('/')+1),v.percent);if(v.sha256)digest=v.sha256;});}
            run(helper,[path],lines);
            if(pending||!digest||!/^[a-f0-9]{64}$/.test(digest))throw new Error('Incomplete checksum result.');return digest;
        }
        function discover(roots) {
            var entries = [], seen = {}, problems = [];
            roots.forEach(function (supplied) {
                var root = canonical(supplied, 'directory'), enumerator = fm.enumeratorAtPath($(root));
                if (!enumerator || enumerator.isNil()) throw new Error('Cannot search folder ' + root);
                while (true) {
                    var next = enumerator.nextObject;
                    if (!next || next.isNil()) break;
                    var rel = ObjC.unwrap(next), path = root + '/' + rel;
                    try {
                        var info = stat(path);
                        if (info.kind === 'symlink') { enumerator.skipDescendants; continue; }
                        if (info.kind !== 'file' || !/\.dmg$/i.test(rel)) continue;
                        // Intermediate images are not complete MavericksForever installers.
                        if (/\/(BaseSystem|InstallESD)\.dmg$/i.test(path)) continue;
                        if (!seen[path]) { entries.push({path: path, name: rel, bytes: info.bytes, modified: info.modified}); seen[path] = true; }
                    } catch (error) { problems.push({path: path, error: String(error)}); enumerator.skipDescendants; }
                }
            });
            entries.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
            return {candidates: entries, skipped: problems, verified: false};
        }
        function componentNames(names) {
            if (!Array.isArray(names) || names.indexOf('PackageInfo') < 0 ||
                names.some(function (name, i) { return ['PackageInfo', 'Bom', 'Payload'].indexOf(name) < 0 || names.indexOf(name) !== i; })) throw new Error('Unexpected component member selection.');
        }
        function requireRoot() {
            if (ObjC.unwrap($.NSUserName()) !== 'root') throw new Error('Installing packages into the private system image requires administrator authentication.');
        }
        function systemStage(stage) {
            requireRoot();
            if(stage && freshDestinations[stage.root]) {
                var binding=freshDestinations[stage.root];
                if(binding.stage!==stage || binding.target.current()!==stage || !stage.writable || !stage.enforceOwners)throw new Error('Fresh destination changed.');
                ownedJob(stage.job);binding.guard(stage);return;
            }
            if (!stage || mounts[stage.root] !== stage || !stage.writable || !stage.enforceOwners || !systemImages[stage.image]) throw new Error('Only a newly created private system image may receive installation packages.');
            ownedFile(stage.image, stage.job); assertMount(stage);
            if (stage.root === '/' || stage.root.indexOf(stage.job + '/mount-') !== 0) throw new Error('Invalid staged system root.');
        }
        function installedStageGuard(stage) {
            systemStage(stage);
            if(freshDestinations[stage.root])return freshDestinations[stage.root].guard;
            var root = stage.root, image = stage.image, job = stage.job, device = stage.device;
            var rootIdentity = stat(root).identity, imageIdentity = stat(image).identity;
            // Full image/device/format checks bracket the phase. Between them,
            // verify the root's device+inode and the image inode before every
            // operation. Unmounting exposes the host mountpoint, whose identity
            // differs. The root-owned private job is never a user disk target.
            function guard(given) {
                requireRoot();
                if (given !== stage || stage.root !== root || stage.image !== image || stage.job !== job || stage.device !== device ||
                    mounts[root] !== stage || !stage.writable || !stage.enforceOwners || !systemImages[image]) throw new Error('Private stage ownership changed.');
                if (ownedFile(image, job).identity !== imageIdentity ||
                    noLinks(job, root.slice(job.length + 1), 'directory').identity !== rootIdentity) throw new Error('Private image or mounted filesystem identity changed.');
            }
            guard.revalidate = function () { guard(stage); systemStage(stage); assertMount(stage, true); };
            return guard;
        }
        function readOnlyMountGuard(stage) {
            requireRoot();ownedJob(stage.job);assertMount(stage);
            if(mounts[stage.root]!==stage || stage.writable || !stage.enforceOwners)throw new Error('An owned read-only source mount is required.');
            var root=stage.root,image=stage.image,job=stage.job,device=stage.device;
            var rootID=stat(root).identity,imageID=stat(image).identity;
            function guard(given) {
                requireRoot();ownedJob(job);
                if(given!==stage || stage.root!==root || stage.image!==image || stage.job!==job || stage.device!==device ||
                    mounts[root]!==stage || stage.writable || stat(image).identity!==imageID ||
                    noLinks(job,root.slice(job.length+1),'directory').identity!==rootID)throw new Error('Read-only image identity changed.');
            }
            guard.revalidate=function(){guard(stage);assertMount(stage, true);};return guard;
        }
        function removeRegular(path, job) {
            ownedFile(path, job);
            var error = Ref();
            if (!fm.removeItemAtPathError($(path), error)) fail(error, 'Could not remove private component file.');
        }
        function removeEmpty(directory, job) {
            ownedJob(job);
            if (directory.indexOf(job + '/') !== 0) throw new Error('Directory is outside the private job.');
            noLinks(job, directory.slice(job.length + 1), 'directory');
            if (directoryNames(directory).length) throw new Error('Private component directory is not empty.');
            var error = Ref();
            if (!fm.removeItemAtPathError($(directory), error)) fail(error, 'Could not remove an empty private directory.');
        }
        function treeNames(root) {
            var result = [''];
            function visit(directory, prefix) {
                directoryNames(directory).forEach(function (name) {
                    var rel = prefix ? prefix + '/' + name : name, child = root + '/' + rel;
                    relative(rel); result.push(rel);
                    // Enumerate every hidden entry, but never descend through links.
                    if (stat(child).kind === 'directory') visit(child, rel);
                });
            }
            if (stat(root).kind === 'directory') visit(root, '');
            return result.sort();
        }
        function verifyTree(root, entries, owners, includeRoot) {
            if (stat(root).kind === 'directory') {
                // The pinned native scanner hashes and inspects each member with
                // no-follow traversal and detects changes during its scan. Avoid
                // launching shasum separately for hundreds of payload files.
                return manifestModule().verifyPayload(scanTree(root), entries, owners, includeRoot);
            }
            var actual = treeNames(root);
            if (!includeRoot) actual.shift();
            var expected = entries.map(function (e) { return e.path; }).sort();
            if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Payload tree members differ: ' + root);
            entries.forEach(function (entry) {
                var file = entry.path ? root + '/' + entry.path : root;
                var info = entry.path ? noLinks(root, entry.path, entry.kind) : stat(root);
                if (info.kind !== entry.kind || (entry.kind !== 'symlink' && info.mode !== entry.mode) ||
                    (owners && (info.uid !== entry.uid || info.gid !== entry.gid))) throw new Error('Payload type or permissions differ: ' + entry.path);
                if (entry.kind === 'file' && (info.bytes !== entry.bytes || sha256(file) !== entry.sha256)) throw new Error('Payload file checksum differs: ' + entry.path);
                if (entry.kind === 'symlink') {
                    var error = Ref(), link = fm.destinationOfSymbolicLinkAtPathError($(file), error);
                    if (!link || link.isNil()) fail(error, 'Cannot inspect payload link.');
                    if (ObjC.unwrap(link) !== entry.link) throw new Error('Payload symbolic link differs: ' + entry.path);
                }
            });
        }
        function componentSourceEntries(catalog, component) {
            return catalog.archiveEntries.filter(function (entry) {
                return entry.path === component.source || entry.path.indexOf(component.source + '/') === 0;
            }).map(function (entry) {
                var copy = JSON.parse(JSON.stringify(entry));
                copy.path = entry.path.slice(component.source.length).replace(/^\//, '');
                return copy;
            });
        }
        function installedParent(stage, rel) {
            systemStage(stage); relative(rel);
            var parent = rel.split('/').slice(0, -1), current = stage.root;
            parent.forEach(function (part) {
                current += '/' + part;
                if (!exists(current)) {
                    var error = Ref();
                    if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(current), false,
                        $({NSFilePosixPermissions: 493, NSFileOwnerAccountID: 0, NSFileGroupOwnerAccountID: 0}), error)) fail(error, 'Cannot create a model-patch parent.');
                }
                if (stat(current).kind !== 'directory') throw new Error('Model-patch parent is not a real directory.');
            });
            return stage.root + '/' + rel;
        }
        function normalizeComponent(root, entries) {
            entries.forEach(function (entry) {
                var p = entry.path ? root + '/' + entry.path : root;
                if (entry.path) noLinks(root, entry.path, entry.kind);
                if (entry.kind === 'symlink') run('/usr/sbin/chown', ['-h', '0:0', p]);
                else {
                    var error = Ref();
                    if (!fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions: entry.mode,
                        NSFileOwnerAccountID: 0, NSFileGroupOwnerAccountID: 0}), $(p), error)) fail(error, 'Cannot set released component permissions.');
                }
            });
        }
        function unpackNVMe(job,catalog) {
            ownedJob(job);
            if(catalog.archive!=='NVMe-Driver-High-Sierra-R3.tar.gz')throw new Error('Unexpected NVMe archive; this build requires NVMe-Driver-High-Sierra-R3.tar.gz.');
            var fingerprint=JSON.stringify(catalog), prepared=unpackedNVMe[job];
            if(prepared){
                if(prepared.fingerprint!==fingerprint || canonical(prepared.root,'directory')!==prepared.root)throw new Error('The prepared NVMe payload changed.');
                return prepared.root;
            }
            var source=canonical(resourceRoot+'/../BundledInputs/'+catalog.archive,'file');
            var archive=destination(job,'nvme-support.tar.gz');
            run('/usr/bin/ditto',['--rsrc','--extattr',source,archive]);
            if(stat(archive).bytes!==catalog.archiveBytes||sha256(archive)!==catalog.archiveSHA256)throw new Error('Bundled NVMe archive differs.');
            var root=destination(job,'nvme-inputs');mkdir(root);run('/usr/bin/tar',['-xzpf',archive,'-C',root]);
            // Implicit archive parents inherit the host group. Normalize every
            // catalogued entry before the same native payload verification.
            normalizeComponent(root,catalog.archiveEntries);verifyTree(root,catalog.archiveEntries,true,false);
            // A root-owned private job keeps this verified extraction for the
            // later install stage; do not unpack and hash the archive twice.
            unpackedNVMe[job]={fingerprint:fingerprint,root:root};return root;
        }
        function manifestModule() {
            return Function(readText(resourceRoot + '/TreeManifest.js') + '\nreturn MavericksResurrectionTreeManifest;')();
        }
        function scanTree(root) {
            var executable = canonical(resourceRoot + '/../BundledTools/TreeManifest', 'file');
            var asset = readJSON(resourceRoot + '/../assets/NativeTools.json').tools.TreeManifest;
            if (!asset || stat(executable).bytes !== asset.bytes || sha256(executable) !== asset.sha256) throw new Error('The bundled filesystem verifier differs.');
            tools[executable] = true;
            var result;
            try { result = decode(run(executable, [canonical(root, 'directory')])).trim().split('\n').map(JSON.parse); }
            finally { delete tools[executable]; }
            manifestModule().validate(result);
            return result;
        }
        function assertExternalRoot(root, stage) {
            var record = externalRoots[root];
            if (!record || record.job !== stage.job || canonical(root, 'directory') !== root) throw new Error('The filtered package source was not prepared by this worker.');
            ownedJob(record.job); assertMount(record.source);
            noLinks(record.job, root.slice(record.job.length + 1), 'directory');
            manifestModule().compare(record.expected, scanTree(root));
        }
        return {
            progress: progress, stat: stat, sha256: sha256, hashImage:hashImage, discover: discover, readText: readText,
            assertInstalledStage: systemStage,
            bindFreshDestination: function(target) {
                requireRoot();var stage=target.current();ownedJob(stage.job);
                if(stage.root!==stage.job+'/destination' || !stage.writable || !stage.enforceOwners || freshDestinations[stage.root])throw new Error('Invalid fresh destination capability.');
                target.assertEmpty();var guard=target.guard();guard.revalidate();
                freshDestinations[stage.root]={stage:stage,target:target,guard:guard};
                return function(){delete freshDestinations[stage.root];};
            },
            cleanupInstallationScratch: function(job) {
                requireRoot();ownedJob(job);
                if(Object.keys(mounts).some(function(k){return mounts[k].job===job;}))throw new Error('A source is still mounted.');
                directoryNames(job).forEach(function(n){
                    if(['BaseSystem.dmg','filtered-base-resources','model-inputs','nvme-inputs','model-support.tar.gz','nvme-support.tar.gz'].indexOf(n)<0 && !/^(Runtime-|preserved-staging-)/.test(n))return;
                    var p=job+'/'+n;if(canonical(p,stat(p).kind)!==p)throw new Error('Scratch path changed.');
                    if(!fm.removeItemAtPathError($(p),null))throw new Error('Could not remove completed installer scratch: '+n);
                });
            },
            installedStageGuard: installedStageGuard,
            readOnlyMountGuard: readOnlyMountGuard,
            writableImageGuard: function (stage) {
                requireRoot();ownedFile(stage.image,stage.job);assertMount(stage);
                if(mounts[stage.root]!==stage || !stage.writable || !stage.enforceOwners)throw new Error('A private writable image with ownership enabled is required.');
                var root=stage.root,image=stage.image,job=stage.job,device=stage.device;
                var rootID=stat(root).identity,imageID=stat(image).identity;
                function guard(given){
                    requireRoot();
                    if(given!==stage || stage.root!==root || stage.image!==image || stage.job!==job || stage.device!==device ||
                        mounts[root]!==stage || !stage.writable || !stage.enforceOwners || ownedFile(image,job).identity!==imageID ||
                        noLinks(job,root.slice(job.length+1),'directory').identity!==rootID)throw new Error('Private writable image identity changed.');
                }
                guard.revalidate=function(){guard(stage);assertMount(stage, true);};return guard;
            },
            verifyPayloadTree: verifyTree,
            detachedPrivateImageIdentity: function(image,job){
                requireRoot();ownedFile(image,job);
                function detached(){if(Object.keys(mounts).some(function(k){return mounts[k].image===image;}) ||
                    (plist('/usr/bin/hdiutil',['info','-plist']).images||[]).some(function(e){return e['image-path']===image;}))throw new Error('The private image must be detached before sealing.');}
                detached();var before=ownedFile(image,job),digest=sha256(image);detached();var after=ownedFile(image,job);
                if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('The private image changed while sealing.');
                return {path:image,bytes:after.bytes,sha256:digest,identity:after.identity,modified:after.modified};
            },
            assertAbsentStagePath: function (stage, rel) {
                if (['System/Library/Extensions/IONVMeFamily.kext', 'System/Library/Extensions/NVMeGeneric.kext'].indexOf(rel) < 0) throw new Error('Unexpected fresh NVMe location.');
                var target = installedParent(stage, rel);
                if (exists(target)) throw new Error('The fresh image already contains an NVMe driver. It was not overwritten: ' + rel);
            },
            prepareNVMePayload: function (stage, catalog) {
                systemStage(stage);
                var root=unpackNVMe(stage.job,catalog);
                nvmePayloads[root] = {stage: stage, catalog: catalog};
                return root;
            },
            preflightNVMePayload:function(job,catalog){return unpackNVMe(job,catalog);},
            prepareMaintenanceNVMePayload:function(job,catalog){return unpackNVMe(job,catalog);},
            preparePostUpdatePayload:function(job,catalog){
                ownedJob(job);
                if(catalog.archive!=='Released-Model-Support.tar.gz')throw new Error('Unexpected compatibility repair archive.');
                var source=canonical(resourceRoot+'/../BundledInputs/'+catalog.archive,'file');
                var archive=destination(job,'model-support.tar.gz');run('/usr/bin/ditto',['--rsrc','--extattr',source,archive]);
                if(stat(archive).bytes!==catalog.archiveBytes||sha256(archive)!==catalog.archiveSHA256)throw new Error('Bundled compatibility archive differs.');
                var root=destination(job,'model-inputs');mkdir(root);run('/usr/bin/tar',['-xzpf',archive,'-C',root]);
                verifyTree(root,catalog.archiveEntries,false,false);return root;
            },
            installFreshNVMeComponent: function (stage, payload, component) {
                systemStage(stage);
                var state = nvmePayloads[payload];
                if (!state || state.stage !== stage || state.catalog.components.indexOf(component) < 0) throw new Error('Unverified NVMe component selection.');
                var source = payload + '/' + component.source;
                verifyTree(source, component.entries, true, true);
                var target = installedParent(stage, component.target), temporary = target + '.mavericksresurrection-new', error = Ref();
                if (exists(target) || exists(temporary)) throw new Error('An existing NVMe driver or unfinished installation was retained.');
                run('/usr/bin/ditto', ['--rsrc', '--extattr', source, temporary]);
                normalizeComponent(temporary, component.entries);
                verifyTree(temporary, component.entries, true, true);
                systemStage(stage); installedParent(stage, component.target);
                if (exists(target)) throw new Error('The NVMe destination changed before installation.');
                if (!fm.moveItemAtPathToPathError($(temporary), $(target), error)) fail(error, 'Cannot install the fresh NVMe driver.');
                verifyTree(target, component.entries, true, true);
            },
            writeInitialNVMeState: function (stage, state) {
                systemStage(stage);
                var rel = 'Library/Application Support/MavericksResurrection/NVMe/initial-state.json';
                var target = installedParent(stage, rel), root = target.slice(0, target.lastIndexOf('/'));
                if (exists(target) || state.schema !== 1 || state.origin !== 'mavericksresurrection-fresh-install') throw new Error('Unexpected initial NVMe state.');
                var error = Ref();
                if (!fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions: 448, NSFileOwnerAccountID: 0, NSFileGroupOwnerAccountID: 0}), $(root), error)) fail(error, 'Cannot protect initial NVMe state.');
                var record = JSON.parse(JSON.stringify(state));
                record.installationID = ObjC.unwrap($.NSUUID.UUID.UUIDString);
                writeText(target, JSON.stringify(record, null, 2) + '\n');
                if (!fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions: 384, NSFileOwnerAccountID: 0, NSFileGroupOwnerAccountID: 0}), $(target), error)) fail(error, 'Cannot protect initial NVMe metadata.');
                if (JSON.stringify(readJSON(target)) !== JSON.stringify(record)) throw new Error('Initial NVMe state readback differs.');
                return {path: rel, sha256: sha256(target), installationID: record.installationID};
            },
            hardware: function () {
                var model = decode(run('/usr/sbin/sysctl', ['-n', 'hw.model'])).trim();
                var registry = decode(run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']));
                var board = registry.match(/"board-id"\s*=\s*<"(Mac-[0-9A-Fa-f]+)"/);
                if (!model || !board) throw new Error('Cannot verify the Mac model and board for the model-patch stage.');
                return {model: model, board: board[1]};
            },
            prepareModelPayload: function (stage, catalog) {
                systemStage(stage);
                var source = canonical(resourceRoot + '/../BundledInputs/' + catalog.archive, 'file');
                var archive = destination(stage.job, 'model-support.tar.gz');
                run('/usr/bin/ditto', ['--rsrc', '--extattr', source, archive]);
                if (stat(archive).bytes !== catalog.archiveBytes || sha256(archive) !== catalog.archiveSHA256) throw new Error('Bundled model archive differs.');
                var root = destination(stage.job, 'model-inputs'); mkdir(root);
                run('/usr/bin/tar', ['-xzpf', archive, '-C', root]);
                // Names may resolve to different numeric owners on another host;
                // installed replacements are normalized and verified as root:wheel.
                verifyTree(root, catalog.archiveEntries, false, false);
                modelPayloads[root] = {stage: stage, catalog: catalog};
                return root;
            },
            replaceModelComponent: function (stage, payload, component) {
                systemStage(stage);
                var state = modelPayloads[payload];
                if (!state || state.stage !== stage || state.catalog.components.indexOf(component) < 0) throw new Error('Unverified model component selection.');
                var source = payload + '/' + component.source;
                verifyTree(source, componentSourceEntries(state.catalog, component), false, true);
                var target = installedParent(stage, component.target);
                var temporary = target + '.mavericks-app-new', previous = target + '.mavericks-app-original';
                if (exists(temporary) || exists(previous)) throw new Error('An unfinished model replacement was retained in the private image.');
                var hadOriginal = exists(target), movedOriginal = false, installedNew = false, error = Ref();
                try {
                    run('/usr/bin/ditto', ['--rsrc', '--extattr', source, temporary]);
                    normalizeComponent(temporary, component.entries);
                    verifyTree(temporary, component.entries, true, true);
                    systemStage(stage); installedParent(stage, component.target);
                    if (hadOriginal) {
                        if (!fm.moveItemAtPathToPathError($(target), $(previous), error)) fail(error, 'Cannot retain the original staged component.');
                        movedOriginal = true;
                    }
                    if (!fm.moveItemAtPathToPathError($(temporary), $(target), error)) fail(error, 'Cannot install the staged model component.');
                    installedNew = true;
                    verifyTree(target, component.entries, true, true);
                } catch (failure) {
                    try {
                        systemStage(stage); installedParent(stage, component.target);
                        if (installedNew && exists(target) && !fm.removeItemAtPathError($(target), error)) fail(error, 'Cannot remove the failed staged replacement.');
                        if (movedOriginal && !fm.moveItemAtPathToPathError($(previous), $(target), error)) fail(error, 'Cannot restore the staged original.');
                    } catch (rollback) { throw new Error(String(failure) + '\nPrivate-image replacement recovery is unfinished: ' + String(rollback)); }
                    throw failure;
                }
                // Only after the replacement and its exact metadata verify.
                if (movedOriginal && !fm.removeItemAtPathError($(previous), error)) fail(error, 'The staged original remains; final staging is incomplete.');
            },
            canonicalFile: function (path) { return canonical(path, 'file'); },
            createJob: createJob, attach: attach, detach: detach, directoryNames: directoryNames,
            regularWithin: function (root, rel) { return noLinks(root, rel, 'file'); },
            directoryWithin: function (root, rel) { return noLinks(root, rel, 'directory'); },
            assertReadOnlyImage: function (record) {
                if (mounts[record.root] !== record || record.writable) throw new Error('A verified read-only source image is required.');
                assertMount(record, true);
            },
            createInstalledImage: function (job) {
                requireRoot(); ownedJob(job);
                var path = job + '/Mavericks-System.sparseimage';
                if (exists(path)) throw new Error('Private system image already exists.');
                // Filesystem-only disk image: no disk partitioning and no physical target.
                run('/usr/bin/hdiutil', ['create', '-size', '24g', '-fs', 'HFS+J', '-layout', 'NONE',
                    '-volname', 'Mavericks App Stage', '-type', 'SPARSE', '-uid', '0', '-gid', '0', '-mode', '0755', path]);
                ownedFile(path, job); systemImages[path] = true;
                return path;
            },
            attachInstalledImage: function (image, job) {
                requireRoot();
                if (!systemImages[image]) throw new Error('System image was not created by this stage worker.');
                return attach(image, job, 'installed', true, true);
            },
            attachVerificationImage: function (image, job) {
                requireRoot(); ownedFile(image,job);
                if (!systemImages[image] || Object.keys(mounts).some(function(k){return mounts[k].image===image;})) throw new Error('Only this worker\'s detached prepared image may be verified.');
                return attach(image,job,'verification',false,true);
            },
            verificationStageGuard: function (stage) {
                requireRoot();ownedFile(stage.image,stage.job);assertMount(stage);
                if(mounts[stage.root]!==stage || stage.writable || !stage.enforceOwners || !systemImages[stage.image])throw new Error('A private read-only verification mount is required.');
                var root=stage.root,image=stage.image,job=stage.job,device=stage.device;
                var rootID=stat(root).identity,imageID=stat(image).identity;
                function guard(given) {
                    requireRoot();
                    if(given!==stage || stage.root!==root || stage.image!==image || stage.job!==job || stage.device!==device ||
                        mounts[root]!==stage || stage.writable || ownedFile(image,job).identity!==imageID ||
                        noLinks(job,root.slice(job.length+1),'directory').identity!==rootID)throw new Error('Read-only verification identity changed.');
                }
                guard.revalidate=function(){guard(stage);assertMount(stage, true);};return guard;
            },
            detachedInstalledImageIdentity: function (image,job) {
                requireRoot();
                function detached() {
                    if(!systemImages[image] || Object.keys(mounts).some(function(k){return mounts[k].image===image;}) ||
                        (plist('/usr/bin/hdiutil',['info','-plist']).images||[]).some(function(e){return e['image-path']===image;}))throw new Error('The prepared image must be detached before sealing.');
                }
                detached();var before=ownedFile(image,job),digest=sha256(image);detached();var after=ownedFile(image,job);
                if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('The prepared image changed while sealing.');
                return {path:image,bytes:after.bytes,sha256:digest,identity:after.identity,modified:after.modified};
            },
            installComponent: function (component, stage) {
                systemStage(stage);
                if (!/^com\.apple\.pkg\.[A-Za-z0-9]+$/.test(component.identifier) || !/^[0-9.]+$/.test(component.version)) throw new Error('Invalid Apple component receipt identity.');
                ownedFile(component.path, stage.job);
                if (sha256(component.path) !== component.sha256) throw new Error('Prepared package changed before installation.');
                if (!component.baseSystemMount || component.baseSystemMount.writable) throw new Error('Mavericks package source mount is missing.');
                assertMount(component.baseSystemMount);
                if (component.identifier === 'com.apple.pkg.BaseSystemResources') assertExternalRoot(component.externalRoot, stage);
                else if (component.externalRoot) throw new Error('Unexpected external package source.');
                // OSInstall contains only reviewed setup scripts. Stripping them
                // leaves no payload, and PackageKit correctly writes no receipt.
                // OfflineSetup performs those actions later; never invent a receipt.
                if (component.delivery === 'offline-setup') {
                    if (component.name !== 'OSInstall.pkg' || component.identifier !== 'com.apple.pkg.OSInstall' ||
                        component.version !== '10.9.0.1' || JSON.stringify(Object.keys(component.members)) !== '["PackageInfo"]') throw new Error('Unexpected setup-only component.');
                    return {kind: 'mavericks-setup-deferred', receiptExpected: false};
                }
                if (component.delivery !== 'package-payload' || !component.members.Bom ||
                    (!component.externalRoot && !component.members.Payload)) throw new Error('Component payload is missing.');
                var meter=Function(readText(resourceRoot+'/ToolProgress.js')+'\nreturn MavericksResurrectionToolProgress;')();
                var packageProgress=meter.create('installer',function(n){notify('install-package','Installing '+component.name+(freshDestinations[stage.root]?' onto the selected Mavericks partition.':' in the temporary Mavericks image.'),n);},function(line){report('installer.output',{message:line});});
                run('/usr/sbin/installer', ['-pkg', component.path, '-target', stage.root, '-verboseR'],function(text){packageProgress.push(text);});
                packageProgress.finish();
                systemStage(stage);
                var receipt = plist('/usr/sbin/pkgutil', ['--volume', stage.root, '--pkg-info-plist', component.identifier]);
                if (receipt.pkgid !== component.identifier || receipt['pkg-version'] !== component.version) throw new Error('Installed component receipt differs: ' + component.identifier);
                if (component.members.Bom) {
                    var rel = 'private/var/db/receipts/' + component.identifier + '.bom';
                    noLinks(stage.root, rel, 'file');
                    if (sha256(stage.root + '/' + rel) !== component.members.Bom.sha256) throw new Error('Installed receipt file manifest differs: ' + component.identifier);
                }
                return receipt;
            },
            inspectStagedVersion: function (stage) {
                systemStage(stage);
                noLinks(stage.root, 'System/Library/CoreServices/SystemVersion.plist', 'file');
                var value = readText(stage.root + '/System/Library/CoreServices/SystemVersion.plist');
                var error = Ref(), parsed = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError($(value).dataUsingEncoding($.NSUTF8StringEncoding), 0, null, error);
                if (!parsed || parsed.isNil()) fail(error, 'Cannot read staged system version.');
                return ObjC.deepUnwrap(parsed);
            },
            writeStageReceipt: function (job, receipt) {
                requireRoot(); ownedJob(job); checkCancellation();
                writeText(job + '/STAGE-PACKAGES.json', JSON.stringify(receipt, null, 2) + '\n');
            },
            prepareExternalRoot: function (baseMount, bom, job, bomSHA256) {
                requireRoot(); ownedJob(job); ownedFile(bom, job);
                if (mounts[baseMount.root] !== baseMount || baseMount.writable) throw new Error('A private read-only BaseSystem mount is required.');
                assertMount(baseMount);
                var catalog = readJSON(resourceRoot + '/../assets/BaseResourceSelection.json');
                if (bomSHA256 !== catalog.bomSHA256 || sha256(bom) !== catalog.bomSHA256) throw new Error('BaseSystemResources BOM differs.');
                var manifests = manifestModule();
                var selector = Function('MavericksResurrectionTreeManifest', readText(resourceRoot + '/BaseResources.js') + '\nreturn MavericksResurrectionBaseResources;')(manifests);
                progress('components', 'Selecting only the installed-system resources from the Mavericks Base System.');
                var expected = selector.selection(decode(run('/usr/bin/lsbom', ['-s', bom])), scanTree(baseMount.root), catalog);
                var root = destination(job, 'filtered-base-resources');
                run('/usr/bin/ditto', ['--rsrc', '--extattr', '--acl', '--bom', bom, baseMount.root, root]);
                // Tahoe ditto drops the sticky bit on these three directories.
                // Restore the exact source permissions before full verification.
                expected.forEach(function (entry) {
                    if (['Volumes', 'private/tmp', 'private/var/tmp'].indexOf(entry.path) < 0) return;
                    var info = noLinks(root, entry.path, 'directory');
                    if (info.mode !== entry.mode) {
                        if (entry.mode !== 1023 || info.mode !== 511) throw new Error('Unexpected resource-directory mode.');
                        var error = Ref();
                        if (!fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions: entry.mode}), $(root + '/' + entry.path), error)) fail(error, 'Cannot preserve resource-directory permissions.');
                    }
                });
                var verification = manifests.compare(expected, scanTree(root));
                externalRoots[root] = {job: job, source: baseMount, expected: expected};
                writeText(job + '/BASE-RESOURCES-VERIFIED.json', JSON.stringify({schema: 1, bomSHA256: bomSHA256,
                    baseSystemSHA256: catalog.baseSystemSHA256, verification: verification,
                    absentOriginalPaths: catalog.absentPaths}, null, 2) + '\n');
                return root;
            },
            readPackageTemplate: function (relativePath, expectedHash) {
                if (!/^PackageInfo\/[A-Za-z][A-Za-z0-9]*\.pkg\.xml$/.test(relativePath)) throw new Error('Invalid package template path.');
                var path = canonical(resourceRoot + '/../assets/' + relativePath, 'file');
                if (sha256(path) !== expectedHash) throw new Error('App package template checksum differs.');
                return readText(path);
            },
            extractComponent: function (archive, output, names, job, hasOriginalScripts, sourceMount) {
                if(sourceMount){
                    if(mounts[sourceMount.root]!==sourceMount||sourceMount.writable||archive.indexOf(sourceMount.root+'/System/Installation/Packages/')!==0)throw new Error('Unowned component source.');
                    assertMount(sourceMount);noLinks(sourceMount.root,archive.slice(sourceMount.root.length+1),'file');
                }else ownedFile(archive, job); writeRoot(output); componentNames(names);
                if (directoryNames(output).length) throw new Error('Component extraction directory is not empty.');
                var listed = decode(run('/usr/bin/xar', ['-tf', archive])).trim().split('\n').sort();
                var expected = names.slice();
                if (hasOriginalScripts) expected.push('Scripts');
                if (JSON.stringify(listed) !== JSON.stringify(expected.sort())) throw new Error('Component archive contains unexpected members.');
                run('/usr/bin/xar', ['-xf', archive, '-C', output].concat(names.map(function (name) { return '^' + name + '$'; })));
            },
            replacePackageInfo: function (directory, text, originalHash, job) {
                var path = directory + '/PackageInfo'; ownedFile(path, job);
                if (sha256(path) !== originalHash) throw new Error('Original package metadata changed before preparation.');
                writeText(path, text);
            },
            packComponent: function (directory, outputRoot, relativePath, names, job) {
                writeRoot(directory); componentNames(names); ownedJob(job);
                if (JSON.stringify(directoryNames(directory).sort()) !== JSON.stringify(names.slice().sort())) throw new Error('Unexpected files in prepared component.');
                names.forEach(function (name) { ownedFile(directory + '/' + name, job); });
                var output = destination(outputRoot, relativePath);
                // xar's -C applies to extraction. Creation explicitly sets the task cwd.
                run('/usr/bin/xar', ['-cf', output, '--compression=none'].concat(names), null, directory);
                ownedFile(output, job);
                return output;
            },
            releaseUnpackedPayload: function(directory,job){
                ownedJob(job);noLinks(job,directory.slice(job.length+1),'directory');
                if(!/^component-[A-Za-z][A-Za-z0-9]*\.pkg\/unpacked$/.test(directory.slice(job.length+1)))throw new Error('Unexpected extraction directory.');
                var p=directory+'/Payload';if(exists(p))removeRegular(p,job);
            },
            removeComponentWorkspace: function (directory, job) {
                ownedJob(job);
                if (directory.indexOf(job + '/component-') !== 0 || !/^component-[A-Za-z][A-Za-z0-9]*\.pkg$/.test(directory.slice(job.length + 1))) throw new Error('Not an app component workspace.');
                noLinks(job, directory.slice(job.length + 1), 'directory');
                var children = directoryNames(directory).sort();
                if (JSON.stringify(children) !== JSON.stringify((exists(directory+'/Original.pkg')?['Original.pkg', 'Prepared.pkg', 'readback', 'unpacked']:['Prepared.pkg', 'readback', 'unpacked']).sort())) throw new Error('Component workspace has unexpected entries; it was retained.');
                ['unpacked', 'readback'].forEach(function (part) {
                    var root = directory + '/' + part;
                    noLinks(directory, part, 'directory');
                    var members = directoryNames(root); componentNames(members);
                    members.forEach(function (name) { removeRegular(root + '/' + name, job); });
                    removeEmpty(root, job);
                });
                if(exists(directory+'/Original.pkg'))removeRegular(directory + '/Original.pkg', job);
                removeRegular(directory + '/Prepared.pkg', job);
                removeEmpty(directory, job);
            },
            makeDirectory: function (job, rel) { var path = destination(job, rel); mkdir(path); return path; },
            ensureFree: function (job, bytes) {
                ownedJob(job);
                var error = Ref(), attributes = fm.attributesOfFileSystemForPathError($(job), error);
                if (!attributes || attributes.isNil()) fail(error, 'Cannot check workspace free space.');
                if (Number(ObjC.unwrap(attributes.objectForKey($.NSFileSystemFreeSize))) < bytes) throw new Error('The workspace needs at least ' + Math.ceil(bytes / (1024 * 1024 * 1024)) + ' GiB free.');
            },
            copyFile: function (source, root, rel) {
                source = canonical(source, 'file');
                run('/usr/bin/ditto', ['--rsrc', '--extattr', source, destination(root, rel)]);
            },
            copyDirectory: function (source, root, rel) {
                source = canonical(source, 'directory');
                run('/usr/bin/ditto', ['--rsrc', '--extattr', source, destination(root, rel)]);
            },
            removePackageLink: function (root) {
                if (!writableRoots[root]) throw new Error('Package link is not in an app image.');
                assertMount(writableRoots[root]);
                noLinks(root, 'System/Installation', 'directory');
                var path = root + '/System/Installation/Packages', error = Ref();
                if (stat(path).kind !== 'symlink') throw new Error('Expected the original BaseSystem Packages symbolic link.');
                if (!fm.removeItemAtPathError($(path), error)) fail(error, 'Could not remove the Packages link.');
            },
            convertImage: function (source, target, format, job) {
                ownedJob(job);
                if (format !== 'UDSP' && format !== 'UDZO') throw new Error('Unexpected image format.');
                if (target !== job + (format === 'UDSP' ? '/InstallMacOSXMavericks.sparseimage' : '/InstallMacOSXMavericks.dmg')) throw new Error('Unexpected image output.');
                if (exists(target)) throw new Error('Image output already exists.');
                // Preserve the upstream settle interval after detaching the source.
                if (format === 'UDZO') $.NSThread.sleepForTimeInterval(2);
                var meter=Function(readText(resourceRoot+'/ToolProgress.js')+'\nreturn MavericksResurrectionToolProgress;')();
                var conversionStep=format==='UDZO'?'Compressing the Mavericks installer image.':'Creating the writable installer image.';
                var conversion=meter.create('image',function(n){notify('image-convert',conversionStep,n);},function(line){
                    report('image.output',{message:line});
                    if(line.indexOf('MESSAGE:')===0){conversionStep=line.slice(8).replace(/\s*\([^)]*\)/g,'').trim();notify('image-convert',conversionStep);}
                });
                progress('image-convert','Converting the Mavericks installer image.');
                run('/usr/bin/hdiutil', ['convert', canonical(source, 'file'), '-format', format, '-o', target,'-puppetstrings'],function(text){conversion.push(text);});
                conversion.finish();
                ownedFile(target, job);
            },
            resizeImage: function (image, bytes, job) {
                ownedFile(image, job);
                if (image !== job + '/InstallMacOSXMavericks.sparseimage' || bytes !== 8 * 1024 * 1024 * 1024) throw new Error('Unexpected image resize.');
                // The upstream 6.55 GB capacity filled before the final package
                // on Tahoe. Empty sparse-image space is not shipped in the DMG.
                // hdiutil's bare size is bytes; its "b" suffix means 512-byte
                // blocks. Read the resulting virtual capacity back as well.
                run('/usr/bin/hdiutil', ['resize', '-size', String(bytes), image]);
                var size = plist('/usr/bin/hdiutil', ['imageinfo', '-plist', image])['Size Information'];
                var actual = size && size['Total Bytes'];
                if (typeof actual !== 'number' || actual < bytes || actual > bytes + 1024 * 1024) throw new Error('The resized image capacity differs from the requested 8 GiB.');
            },
            downloadMavericksForever: function (job) {
                ownedJob(job);
                var meter=Function(readText(resourceRoot+'/DownloadProgress.js')+'\nreturn MavericksResurrectionDownloadProgress;')();
                var download=meter.create(function(percent){notify('download-progress','Downloading Mavericks… '+percent+'%',percent);},function(line){
                    if(line==='Checking downloaded Mavericks file...')notify('verify-download','Checking the downloaded Mavericks image.');
                    else report('download.output',{message:line});
                });
                notify('download-progress','Connecting to Apple to download Mavericks.',null);
                try{
                    run('/bin/bash', [canonical(resourceRoot + '/Download-MavericksForever.sh', 'file'), job, cancelFile || ''],
                        function (text) { download.push(text); });
                }catch(error){
                    if(isCancelled())throw new Error('Download cancelled. The partial download remains in '+job+'.');
                    download.finish();
                    throw new Error(meter.cleanFailure(error)+'\nAny downloaded data has been kept in '+job+'.');
                }
                download.finish();
                ownedFile(job + '/InstallESD.dmg', job);
                return job + '/InstallESD.dmg';
            },
            removeIntermediate: function (path, job) {
                ownedFile(path, job);
                if (path !== job + '/InstallESD.dmg' && path !== job + '/InstallMacOSXMavericks.sparseimage') throw new Error('Not an intermediate file.');
                if (Object.keys(mounts).some(function (root) { return mounts[root].image === path; })) throw new Error('Intermediate is still mounted.');
                var error = Ref();
                if (!fm.removeItemAtPathError($(path), error)) fail(error, 'Could not remove intermediate.');
            },
            writeReceipt: function (job, data) {
                checkCancellation();
                ownedJob(job);
                writeText(job + '/SOURCE-VERIFIED.json', JSON.stringify(data, null, 2) + '\n');
            }
        };
    }
    return {create: create};
}());
