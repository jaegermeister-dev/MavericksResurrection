/* Native cache filesystem operations. Fresh staging uses the private image guard.
 * Maintenance additionally requires a live durable journal guard and confined
 * current-tool executor. Discovery/mount lifecycle remains a separate adapter.
 */
var MavericksResurrectionMacCacheIO = (function () {
    'use strict';
    ObjC.import('Foundation');
    function create(stage, validate, hash, resourceRoot, format, progress, cancelled, diagnostic, information, runtime, context) {
        var maintenance=context && context.kind==='journaled-maintenance'?context:null;
        var installer=context && context.kind==='private-installer'?context:null;
        if(context && ((!maintenance && !installer) || !context.executor || typeof context.executor.run!=='function' ||
            (maintenance && typeof maintenance.assertJournal!=='function') || (installer && typeof installer.assertPrivateImage!=='function')))
            throw new Error('Cache operations require their journal or private installer guard and confined tool executor.');
        var fm = $.NSFileManager.defaultManager, work = null, outputs = {}, published = false;
        function report(event, detail) { try { if (diagnostic) diagnostic(event, detail); } catch (_) {} }
        var cacheRoot = 'System/Library/Caches/com.apple.kext.caches';
        var paths = ['System/Library/Extensions', 'Library/Extensions'];
        function fail(error, message) { throw new Error(message); }
        function guard() { validate(stage); if(maintenance)maintenance.assertJournal(); if(installer)installer.assertPrivateImage(); if (cancelled && cancelled()) throw new Error('Cache preparation cancelled. Recovery data was retained.'); }
        function attributes(path) {
            var result = fm.attributesOfItemAtPathError($(path), null);
            if (!result || result.isNil()) {
                var at = path.lastIndexOf('/'), parent = path.slice(0, at) || '/', name = path.slice(at + 1);
                if (path === '/' || parent === path) fail(null, 'Cannot inspect cache filesystem root.');
                var parentInfo = attributes(parent);
                if (parentInfo === null) return null;
                if (parentInfo.kind !== 'directory') fail(null, 'Cache parent is not a directory: ' + parent);
                var names = fm.contentsOfDirectoryAtPathError($(parent), null);
                if (!names || names.isNil()) fail(null, 'Cannot inspect cache parent: ' + parent);
                if (ObjC.deepUnwrap(names).indexOf(name) < 0) return null;
                fail(null, 'Cannot inspect existing cache path: ' + path);
            }
            var type = ObjC.unwrap(result.objectForKey($.NSFileType));
            return {kind: type === 'NSFileTypeRegular' ? 'file' : type === 'NSFileTypeDirectory' ? 'directory' : type === 'NSFileTypeSymbolicLink' ? 'symlink' : 'other',
                bytes: Number(ObjC.unwrap(result.objectForKey($.NSFileSize))),
                mtime: Number(result.objectForKey($.NSFileModificationDate).timeIntervalSince1970)};
        }
        function relative(value) {
            if (typeof value !== 'string' || !value.length || /[\\\x00-\x1f\x7f]/.test(value) ||
                value.split('/').some(function (p) { return !p || p === '.' || p === '..'; })) throw new Error('Unsafe cache path.');
            return value;
        }
        function path(value, expected, allowMissing) {
            guard();
            var parts = relative(value).split('/'), result = stage.root;
            for (var i = 0; i < parts.length; i++) {
                result += '/' + parts[i];
                var a = attributes(result), last = i === parts.length - 1;
                if (last && !a && allowMissing) return result;
                if (!a || a.kind !== (last ? expected : 'directory')) throw new Error('Missing, linked or unexpected cache path: ' + result);
            }
            return result;
        }
        function permissions(full, mode) {
            var error = Ref();
            if (!fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions: mode, NSFileOwnerAccountID: 0, NSFileGroupOwnerAccountID: 0}), $(full), error)) fail(error, 'Cannot set cache permissions.');
        }
        function directory(value, mode) {
            var parts = relative(value).split('/');
            for (var i = 1; i <= parts.length; i++) {
                var full = path(parts.slice(0, i).join('/'), 'directory', true);
                if (!attributes(full)) {
                    var error = Ref();
                    if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(full), false, $({NSFilePosixPermissions: i === parts.length ? mode : 493}), error)) fail(error, 'Cannot create cache directory.');
                }
            }
        }
        function text(data) {
            var string = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
            if (!string || string.isNil()) throw new Error('Cache tool returned invalid UTF-8.');
            return ObjC.unwrap(string);
        }
        function diagnosticText(data) { try { return text(data); } catch (_) { return '(non-text command output)'; } }
        function run(program, args, binary) {
            guard();
            if (program !== '/usr/sbin/kextcache' && program !== '/usr/bin/gzip') throw new Error('Unexpected cache tool.');
            // Only kextcache runs from the selected Mavericks filesystem.
            // gzip is the host data reader below; the minimal installer has no
            // copy of that binary and does not need one for this verification.
            if(program==='/usr/sbin/kextcache')path(program.slice(1), 'file', false);
            if (args.some(function (a) { return typeof a !== 'string' || /[\x00-\x1f\x7f]/.test(a); })) throw new Error('Invalid cache argument.');
            report('cache.command.started', {program: program, arguments: args});
            if (program === '/usr/sbin/kextcache' && args[0] === '-system-caches') {
                if (!runtime || typeof runtime.run !== 'function') throw new Error('The private information-cache runtime is unavailable.');
                return runtime.run('system-caches');
            }
            if(program==='/usr/sbin/kextcache' && context)return context.executor.run(args,work);
            var task = $.NSTask.alloc.init, output = $.NSPipe.pipe;
            if (program === '/usr/bin/gzip') {
                // gzip is a host data reader; no old runtime or mounted /dev needed.
                if (args.length !== 2 || ['-t', '-cd'].indexOf(args[0]) < 0) throw new Error('Unexpected gzip arguments.');
                task.launchPath = $(program); task.arguments = $([args[0], path(args[1].slice(1), 'file', false)]);
            } else {
                // The original tool runs with host libraries but receives ONLY
                // explicit Mavericks paths. Rooted execution loses signature
                // services and omits stock drivers on Tahoe (native R6 evidence).
                var rooted = args.slice();
                rooted[1] = stage.root + args[1];
                if (args.length > 3) {
                    rooted[6] = stage.root + '/mach_kernel';
                    rooted[8] = stage.root;
                    rooted[rooted.length - 2] = stage.root + '/System/Library/Extensions';
                    rooted[rooted.length - 1] = stage.root + '/Library/Extensions';
                }
                task.launchPath = $(stage.root + program); task.arguments = $(rooted);
            }
            // This is the tool's own lock-suppression switch. Only the app owns this
            // image; a host kextd must neither coordinate nor supply its loaded kexts.
            task.environment = $({PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C', HOME: '/var/root',
                _com_apple_kextd_skiplocks: '1'});
            task.standardInput = $.NSFileHandle.fileHandleForReadingAtPath('/dev/null');
            task.standardOutput = output;
            task.standardError = binary ? $.NSFileHandle.fileHandleForWritingAtPath('/dev/null') : output;
            task.launch;
            var data = output.fileHandleForReading.readDataToEndOfFile;
            task.waitUntilExit;
            report('cache.command.finished', {program: program, status: Number(task.terminationStatus),
                outputBytes: Number(data.length), output: binary ? '(binary cache data)' : diagnosticText(data)});
            if (Number(task.terminationStatus) !== 0) throw new Error('Mavericks ' + program + ' failed: ' + (binary ? 'gzip validation or decompression failed.' : text(data).slice(-48000)));
            guard(); return data;
        }
        function plistData(data) {
            var error = Ref(), value = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, error);
            if (!value || value.isNil()) fail(error, 'Invalid cache property list.');
            return ObjC.deepUnwrap(value);
        }
        function readBundle(absolute) {
            if (absolute.charAt(0) !== '/') throw new Error('Expected a target-root bundle path.');
            // Mavericks includes flat kernel-interface bundles (System.kext and
            // its PlugIns) whose Info.plist is at the bundle root.
            var relative = absolute.slice(1), bundle = path(relative, 'directory', false);
            var contents = attributes(bundle + '/Contents');
            if (contents && contents.kind !== 'directory') throw new Error('Unexpected bundle Contents entry.');
            var full = path(relative + (contents ? '/Contents' : '') + '/Info.plist', 'file', false);
            return plistData($.NSData.dataWithContentsOfFile($(full)));
        }
        function copy(from, to) {
            report('cache.copy', {from: from, to: to});
            var source = path(from, 'file', false), target = path(to, 'file', true), error = Ref();
            if (!work || to.indexOf(work + '/') !== 0 || attributes(target)) throw new Error('Unexpected cache copy destination.');
            if (!fm.copyItemAtPathToPathError($(source), $(target), error)) fail(error, 'Cannot copy cache output.');
            permissions(target, 384);
            if (hash(source) !== hash(target)) throw new Error('Cache copy checksum differs.');
            outputs[to] = true;
        }
        function bytes(data) {
            var encoded = ObjC.unwrap(data.base64EncodedStringWithOptions(0)), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', result = [];
            var value = 0, bits = 0;
            for (var i = 0; i < encoded.length && encoded.charAt(i) !== '='; i++) {
                var digit = alphabet.indexOf(encoded.charAt(i));
                if (digit < 0) throw new Error('Invalid cache byte encoding.');
                value = (value << 6) | digit; bits += 6;
                if (bits >= 8) { bits -= 8; result.push((value >> bits) & 255); }
            }
            return result;
        }
        function xml(data) {
            var error = Ref(), doc = $.NSXMLDocument.alloc.initWithDataOptionsError(data, $.NSXMLNodeLoadExternalEntitiesNever, error);
            if (!doc || doc.isNil()) fail(error, 'Invalid Mavericks cache XML.');
            return doc;
        }
        function children(node) {
            var result = [], count = Number(node.childCount);
            for (var i = 0; i < count; i++) {
                var child = node.childAtIndex(i);
                if (Number(child.kind) === Number($.NSXMLElementKind)) result.push(child);
            }
            return result;
        }
        function nodeName(node) { return ObjC.unwrap(node.name); }
        function nodeText(node) { return ObjC.unwrap(node.stringValue); }
        function prelinkRows(relativePath) {
            var full = path(relativePath, 'file', false), length = attributes(full).bytes;
            var file = $.NSFileHandle.fileHandleForReadingAtPath($(full));
            if (!file || file.isNil()) throw new Error('Cannot open generated boot cache.');
            var fragment;
            try {
                var section = format.prelinkSection({length: length, read: function (offset, count) {
                    file.seekToFileOffset(offset); return bytes(file.readDataOfLength(count));
                }});
                file.seekToFileOffset(section.offset);
                fragment = text(file.readDataOfLength(section.length)).replace(/\x00+$/, '');
            } finally { file.closeFile; }
            // Mavericks emits an IOKit dictionary fragment with empty integer tags.
            // Parse structure without pretending those are normal plist integers.
            var document = xml($('<plist version="1.0">' + fragment + '</plist>').dataUsingEncoding($.NSUTF8StringEncoding));
            var ids = Object.create(null), visited = 0;
            function attr(node, key) { var a = node.attributeForName($(key)); return a && !a.isNil() ? nodeText(a) : null; }
            function index(node, depth) {
                if (++visited > 1000000 || depth > 128) throw new Error('Cache XML is too complex.');
                var identifier = attr(node, 'ID');
                if (identifier !== null) { if (ids[identifier]) throw new Error('Duplicate cache XML identifier.'); ids[identifier] = node; }
                children(node).forEach(function (child) { index(child, depth + 1); });
            }
            var top = document.rootElement;
            index(top, 0);
            function resolve(node) {
                var seen = Object.create(null);
                for (var step = 0; step < 128; step++) {
                    var reference = attr(node, 'IDREF');
                    if (reference === null) return node;
                    if (seen[reference] || !ids[reference]) throw new Error('Invalid cache XML reference.');
                    seen[reference] = true; node = ids[reference];
                }
                throw new Error('Cache XML reference chain is too long.');
            }
            function dictionary(node) {
                node = resolve(node);
                if (nodeName(node) !== 'dict') throw new Error('Expected a cache dictionary.');
                var result = Object.create(null), items = children(node);
                if (items.length % 2) throw new Error('Unpaired cache dictionary key.');
                for (var i = 0; i < items.length; i += 2) {
                    var keyNode = resolve(items[i]), key = nodeText(keyNode);
                    if (nodeName(keyNode) !== 'key' || result[key]) throw new Error('Invalid cache dictionary key.');
                    result[key] = resolve(items[i + 1]);
                }
                return result;
            }
            var roots = children(top);
            if (roots.length !== 1) throw new Error('Unexpected cache XML root.');
            var entries = dictionary(roots[0])._PrelinkInfoDictionary;
            if (!entries || nodeName(entries) !== 'array') throw new Error('Missing prelink bundle array.');
            return children(entries).map(function (entry) {
                var values = dictionary(entry);
                function string(key) {
                    var node = values[key];
                    if (!node || nodeName(node) !== 'string') throw new Error('Missing prelink string: ' + key);
                    return nodeText(node);
                }
                return {id: string('CFBundleIdentifier'), path: string('_PrelinkBundlePath'), version: string('CFBundleVersion')};
            });
        }
        return {
            assertPrivateStage: guard, readBundle: readBundle, progress: progress,
            verifyFile: function (relativePath, expected) { if (hash(path(relativePath, 'file', false)) !== expected) throw new Error('Mavericks cache input checksum differs: ' + relativePath); },
            verifyCandidate: function (candidate) {
                candidate.drivers.forEach(function (driver) { Object.keys(driver.files).forEach(function (file) {
                    if (hash(path(file, 'file', false)) !== driver.files[file]) throw new Error('Experimental driver checksum differs before cache generation.');
                }); });
            },
            begin: function () {
                report('cache.preparation.started', {root: stage.root});
                guard();
                if (work) throw new Error('Cache preparation already started.');
                work = 'private/var/tmp/MavericksResurrection-Cache-' + ObjC.unwrap($.NSUUID.UUID.UUIDString);
                if (attributes(path(work, 'directory', true))) throw new Error('Cache workspace already exists.');
                directory(work, 448);
                var existing = path(cacheRoot, 'directory', true), error = Ref();
                if (attributes(existing) && !fm.moveItemAtPathToPathError($(existing), $(path(work + '/previous-caches', 'directory', true)), error)) fail(error, 'Cannot retain preceding private caches.');
                directory(cacheRoot + '/Startup', 493);
                // The cache timestamp is derived from these directories. Do not
                // modify their mtimes after generating any of the caches.
                if(!maintenance)paths.forEach(function (p) {
                    var full = path(p, 'directory', false);
                    if (!fm.setAttributesOfItemAtPathError($({NSFileModificationDate: $.NSDate.date}), $(full), error)) fail(error, 'Cannot update private extension-directory timestamp.');
                });
                return work;
            },
            runKextcache: function (args) {
                if (!work) throw new Error('Private cache preparation has not started.');
                if (args[0] === '-system-caches') {
                    if (JSON.stringify(args) !== JSON.stringify(['-system-caches', '-arch', 'x86_64', '-verbose', '3'])) throw new Error('Unexpected system-cache arguments.');
                } else {
                    if (args[0] !== '-prelinked-kernel' || args[1].indexOf('/' + work + '/') !== 0) throw new Error('Unexpected cache output.');
                    var relativeOutput = args[1].slice(1), filename = relativeOutput.slice(work.length + 1);
                    if (['uncompressed', 'compressed', 'roundtrip'].indexOf(filename) < 0 && !(context && filename==='inspection')) throw new Error('Unexpected cache output name.');
                    path(relativeOutput, 'file', filename === 'uncompressed');
                    if (filename === 'uncompressed' && attributes(stage.root + '/' + relativeOutput)) throw new Error('Cache build output already exists.');
                    if (filename !== 'uncompressed' && !outputs[relativeOutput]) throw new Error('Cache conversion requires an owned copy.');
                    if (filename !== 'uncompressed') {
                        if (args.length !== 3 || args[2] !== (filename === 'compressed' ? '-compressed' : '-uncompressed')) throw new Error('Unexpected cache conversion arguments.');
                    } else {
                        var prefix = ['-uncompressed', '-arch', 'x86_64', '-kernel', '/mach_kernel', '-volume-root', '/', '-print-diagnostics', '-verbose', '3'];
                        if (JSON.stringify(args.slice(2, 12)) !== JSON.stringify(prefix) ||
                            JSON.stringify(args.slice(-3)) !== JSON.stringify(['--', '/System/Library/Extensions', '/Library/Extensions'])) throw new Error('Cache build must use the private Mavericks root.');
                        var selectors = args.slice(12, -3), at = selectors[0] === '-local-root' ? 1 : 0;
                        if (!selectors.length) throw new Error('Cache selection must be explicit.');
                        for (; at < selectors.length; at += 2) {
                            if (selectors[at] !== '-bundle-id' || typeof selectors[at + 1] !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(selectors[at + 1])) throw new Error('Unexpected cache selection argument.');
                        }
                    }
                }
                run('/usr/sbin/kextcache', args, false);
            },
            verifyGzip: function (file) {
                var full = path(file, 'file', false);
                if (attributes(full).bytes < 20) throw new Error('Missing or empty startup information cache.');
                run('/usr/bin/gzip', ['-t', '/' + file], true);
                var data = run('/usr/bin/gzip', ['-cd', '/' + file], true);
                if (!information || typeof information.inspect !== 'function') throw new Error('Information-cache validator is unavailable.');
                var result = information.inspect(file.slice(file.lastIndexOf('/') + 1), data);
                report('cache.information.verified', {file: file, format: result.format, entries: result.entries});
                return result;
            },
            prelinkRows: prelinkRows, copy: copy,
            preservePreviousAlert:function(){
                guard();if(!context || !work)throw new Error('Previous alert preservation requires a guarded cache context.');
                var from=path(work+'/previous-caches/Startup/noloadkextalert.plist','file',true);
                if(!attributes(from))return false;
                var to=path(cacheRoot+'/Startup/noloadkextalert.plist','file',true);
                if(attributes(to)||!fm.copyItemAtPathToPathError($(from),$(to),null)||hash(from)!==hash(to))throw new Error('Cannot preserve the existing alert cache.');permissions(to,420);return true;
            },
            sha256: function (file) { return hash(path(file, 'file', false)); },
            copyAlert: function (asset, destination) {
                if (destination !== cacheRoot + '/Startup/noloadkextalert.plist' || asset.asset !== 'Cache/noloadkextalert.plist') throw new Error('Unexpected alert cache.');
                var source = resourceRoot + '/assets/' + asset.asset, info = attributes(source), target = path(destination, 'file', true), error = Ref();
                if (!info || info.kind !== 'file' || hash(source) !== asset.sha256 || attributes(target)) throw new Error('Invalid released alert input.');
                if (!fm.copyItemAtPathToPathError($(source), $(target), error)) fail(error, 'Cannot install the released alert metadata.');
                permissions(target, 420);
                if (hash(target) !== asset.sha256) throw new Error('Alert cache copy differs.');
            },
            publish: function (from, to) {
                report('cache.publish', {from: from, to: to});
                if (!work || from !== work + '/compressed' || to !== cacheRoot + '/Startup/kernelcache' || published) throw new Error('Unexpected cache publication.');
                var source = path(from, 'file', false), target = path(to, 'file', true), error = Ref();
                if (attributes(target) || attributes(source).bytes < 1048576) throw new Error('Unexpected generated cache size or existing output.');
                if (!fm.copyItemAtPathToPathError($(source), $(target), error)) fail(error, 'Cannot publish the boot cache.');
                permissions(target, 420);
                var mtime = Math.floor(Math.max(attributes(path('mach_kernel', 'file', false)).mtime,
                    attributes(path('System/Library/Extensions', 'directory', false)).mtime,
                    attributes(path('Library/Extensions', 'directory', false)).mtime)) + 1;
                if (!fm.setAttributesOfItemAtPathError($({NSFileModificationDate: $.NSDate.dateWithTimeIntervalSince1970(mtime)}), $(target), error)) fail(error, 'Cannot set boot-cache timestamp.');
                if (hash(source) !== hash(target) || Math.floor(attributes(target).mtime) !== mtime) throw new Error('Published boot-cache verification failed.');
                published = true;
            },
            complete: function (workspace, receipt) {
                guard();
                if (!published || workspace !== work || !receipt.completed) throw new Error('Cache preparation did not complete.');
                var result = path(work + '/CACHE-VERIFIED.json', 'file', true), error = Ref();
                if (attributes(result)) throw new Error('Cache completion record already exists.');
                if (!$(JSON.stringify(receipt, null, 2) + '\n').writeToFileAtomicallyEncodingError($(result), true, $.NSUTF8StringEncoding, error)) fail(error, 'Cannot save private cache verification state.');
                permissions(result, 384);
                report('cache.preparation.completed', receipt);
                // Keep the previous caches and roundtrip evidence in this private
                // preparation image until final staging verification/cleanup.
            }
        };
    }
    return {create: create};
}());
