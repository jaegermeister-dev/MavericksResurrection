/* macOS-only setup adapter, restricted to a live private-image stage capability.
 * The validator comes from MacSourceIO's process-local image ownership records.
 * Original package scripts are never dispatched on the modern host.
 */
var MavericksMacOfflineSetupIO = (function () {
    'use strict';
    ObjC.import('Foundation');
    function create(stage, validate, progress, diagnostic, options) {
        var fm = $.NSFileManager.defaultManager;
        function report(event, detail) { try { if (diagnostic) diagnostic(event, detail); } catch (_) {} }
        var allowed = ['/bin/chmod', '/usr/sbin/chown', '/usr/bin/chflags', '/usr/bin/touch'];
        // Do not dereference an autoreleased NSError through JXA Ref. Tahoe's
        // bridge can retain a stale pointer and crash instead of throwing.
        function error(e, message) { throw new Error(message); }
        function run(program, args) {
            validate(stage);
            if (allowed.indexOf(program) < 0 || args.some(function (arg) { return typeof arg !== 'string' || /[\x00\n\r]/.test(arg); })) throw new Error('Unexpected setup command.');
            report('setup.command.started', {program: program, arguments: args});
            var task = $.NSTask.alloc.init, pipe = $.NSPipe.pipe;
            task.launchPath = $(program); task.arguments = $(args);
            task.environment = $({PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C', HOME: '/var/root'});
            task.standardInput = $.NSFileHandle.fileHandleForReadingAtPath('/dev/null');
            task.standardOutput = pipe; task.standardError = pipe; task.launch;
            var bytes = pipe.fileHandleForReading.readDataToEndOfFile;
            task.waitUntilExit;
            var string = $.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding);
            var output = string && !string.isNil() ? ObjC.unwrap(string) : '(non-text output)';
            report('setup.command.finished', {program: program, status: Number(task.terminationStatus), output: output});
            if (Number(task.terminationStatus) !== 0) throw new Error(program + ' failed during private-image setup: ' + output);
            return output;
        }
        function attributes(path) {
            var a = fm.attributesOfItemAtPathError($(path), null);
            if (!a || a.isNil()) {
                var at = path.lastIndexOf('/'), parent = path.slice(0, at) || '/', name = path.slice(at + 1);
                if (path === '/' || parent === path) error(null, 'Cannot inspect setup filesystem root.');
                var parentKind = attributes(parent);
                if (parentKind === null) return null;
                if (parentKind !== 'directory') error(null, 'Setup parent is not a directory: ' + parent);
                var names = fm.contentsOfDirectoryAtPathError($(parent), null);
                if (!names || names.isNil()) error(null, 'Cannot inspect setup parent: ' + parent);
                if (ObjC.deepUnwrap(names).indexOf(name) < 0) return null;
                error(null, 'Cannot inspect existing setup path: ' + path);
            }
            var type = ObjC.unwrap(a.objectForKey($.NSFileType));
            return type === 'NSFileTypeDirectory' ? 'directory' : type === 'NSFileTypeRegular' ? 'file' : type === 'NSFileTypeSymbolicLink' ? 'symlink' : 'other';
        }
        function path(relative, finalLink, missingParents) {
            validate(stage);
            if (typeof relative !== 'string' || /[\\\x00-\x1f\x7f]/.test(relative) || relative.split('/').some(function (p) { return !p || p === '.' || p === '..'; })) throw new Error('Unsafe setup path.');
            var current = stage.root, parts = relative.split('/');
            for (var i = 0; i < parts.length; i++) {
                current += '/' + parts[i];
                var type = attributes(current);
                if (!type && missingParents) return stage.root + '/' + relative;
                if (i < parts.length - 1 && type !== 'directory') throw new Error('Setup parent is missing or a link: ' + current);
                if (i === parts.length - 1 && type === 'symlink' && !finalLink) throw new Error('Setup refuses to follow a symbolic link: ' + current);
                if (type === 'other') throw new Error('Unexpected setup file type.');
            }
            return current;
        }
        function kind(relative) {
            var p = path(relative, true, true);
            // Missing intermediate directories are acceptable only for inspection;
            // any existing intermediate symbolic link was refused by path().
            return attributes(p);
        }
        function directory(relative) {
            report('setup.directory', {path: relative});
            var parts = relative.split('/');
            for (var i = 1; i <= parts.length; i++) {
                var rel = parts.slice(0, i).join('/'), p = path(rel, false, false), t = attributes(p);
                if (!t) {
                    var e = Ref();
                    if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(p), false, $({NSFilePosixPermissions: 493}), e)) error(e, 'Cannot create setup directory.');
                } else if (t !== 'directory') throw new Error('Setup requires a directory.');
            }
        }
        function names(relative) {
            var p = path(relative, false, false), e = Ref();
            if (attributes(p) !== 'directory') throw new Error('Setup listing requires a directory.');
            var list = fm.contentsOfDirectoryAtPathError($(p), e);
            if (!list || list.isNil()) error(e, 'Cannot list setup directory.');
            return ObjC.deepUnwrap(list);
        }
        return {
            assertFreshSystem: function () { validate(stage); }, progress: progress,
            prepareFirstBootSetup: function () {
                validate(stage);
                if (!options || !options.firstBootPlan || !options.resources || typeof options.hash !== 'function') throw new Error('First-boot preparation is unavailable.');
                var plan = options.firstBootPlan.plan(ObjC.unwrap($.NSUUID.UUID.UUIDString), options.diagnosticsRequested === true, options.firstBootCatalog);
                plan.inputs.forEach(function (entry) {
                    var full = path(entry.path, false, false);
                    if (attributes(full) !== 'file') throw new Error('First-boot input is not a regular file.');
                    var a = fm.attributesOfItemAtPathError($(full), null);
                    function value(key) { return Number(ObjC.unwrap(a.objectForKey($(key)))); }
                    if (value('NSFileSize') !== entry.bytes || value('NSFilePosixPermissions') !== entry.mode || value('NSFileOwnerAccountID') !== entry.uid || value('NSFileGroupOwnerAccountID') !== entry.gid || options.hash(full) !== entry.sha256) throw new Error('Original first-boot program differs: ' + entry.path);
                });
                function resource(relative) {
                    var p = options.resources + '/' + relative;
                    if (ObjC.unwrap($(p).stringByStandardizingPath.stringByResolvingSymlinksInPath) !== p || attributes(p) !== 'file') throw new Error('First-boot resource is missing or linked.');
                    return p;
                }
                var catalogText = $.NSString.stringWithContentsOfFileEncodingError($(resource('assets/NativeTools.json')), $.NSUTF8StringEncoding, null);
                if (!catalogText || catalogText.isNil()) throw new Error('Missing first-boot helper catalog.');
                var catalog = JSON.parse(ObjC.unwrap(catalogText)), asset = catalog.tools.FirstBootSetup, helper = resource('BundledTools/FirstBootSetup');
                if (catalog.schema !== 1 || !asset || asset.minimumTargetOS !== '10.9' || Number(ObjC.unwrap(fm.attributesOfItemAtPathError($(helper), null).objectForKey($.NSFileSize))) !== asset.bytes || options.hash(helper) !== asset.sha256) throw new Error('The first-boot helper differs.');
                if (kind(plan.folder) || kind(plan.daemon.path) || kind(plan.notice.path)) throw new Error('First-boot setup files already exist; retained for inspection.');
                directory(plan.folder); directory('Library/LaunchDaemons'); directory('Library/LaunchAgents');
                function protect(full, mode) {
                    if (!fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions: mode, NSFileOwnerAccountID: 0, NSFileGroupOwnerAccountID: 0}), $(full), null)) throw new Error('Cannot protect first-boot setup files.');
                }
                protect(path('Library/Application Support/MavericksResurrection', false, false), 493);
                protect(path(plan.folder, false, false), 493);
                var installed = path(plan.folder + '/FirstBootSetup', false, false);
                if (!fm.copyItemAtPathToPathError($(helper), $(installed), null)) throw new Error('Cannot install the first-boot helper.');
                protect(installed, 493);
                if (options.hash(installed) !== asset.sha256 || options.hash(helper) !== asset.sha256) throw new Error('First-boot helper copy differs.');
                var statePath = path(plan.folder + '/State.json', false, false), stateText = JSON.stringify(plan.state, null, 2) + '\n';
                if (!$(stateText).writeToFileAtomicallyEncodingError($(statePath), true, $.NSUTF8StringEncoding, null)) throw new Error('Cannot record pending first-boot setup.');
                protect(statePath, 420);
                var readback = $.NSString.stringWithContentsOfFileEncodingError($(statePath), $.NSUTF8StringEncoding, null);
                if (!readback || readback.isNil() || ObjC.unwrap(readback) !== stateText) throw new Error('First-boot state readback differs.');
                [plan.daemon, plan.notice].forEach(function (job) {
                    var data = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError($(job.content), $.NSPropertyListXMLFormat_v1_0, 0, null);
                    var destination = path(job.path, false, false);
                    if (!data || data.isNil() || !data.writeToFileOptionsError($(destination), $.NSDataWritingAtomic, null)) throw new Error('Cannot install a first-boot startup job.');
                    protect(destination, 420);
                    var parsed = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError($.NSData.dataWithContentsOfFile($(destination)), 0, null, null);
                    if (!parsed || parsed.isNil() || !parsed.isEqual($(job.content))) throw new Error('First-boot job readback differs.');
                });
                validate(stage);
                var result = {kind: 'mavericks-first-boot-prepared', configured: true, runConfirmed: false, installID: plan.state.installID,
                    steps: plan.state.steps.map(function (s) { return s.id; }), state: plan.folder + '/State.json', helperSHA256: asset.sha256,
                    diagnosticsRequested: plan.state.diagnosticsRequested, diagnosticCapture: plan.state.diagnosticsRequested ? plan.folder + '/Diagnostics.log' : null};
                report('setup.first-boot.configured', result); return result;
            },
            verifyStockKeychainInitialization: function () {
                if (!options || !options.keychain || typeof options.hash !== 'function') throw new Error('Stock keychain verification is unavailable.');
                var result = options.keychain.verify({
                    assertFreshSystem: function () { validate(stage); }, kind: kind,
                    inspectStockFile: function (relative) {
                        var full = path(relative, false, false);
                        if (attributes(full) !== 'file') throw new Error('Stock dependency is not a regular file.');
                        var a = fm.attributesOfItemAtPathError($(full), null);
                        function value(key) { return Number(ObjC.unwrap(a.objectForKey($(key)))); }
                        return {kind: 'file', bytes: value('NSFileSize'), mode: value('NSFilePosixPermissions'), uid: value('NSFileOwnerAccountID'), gid: value('NSFileGroupOwnerAccountID'), sha256: options.hash(full)};
                    },
                    readStockPlist: function (relative) {
                        var full = path(relative, false, false);
                        if (attributes(full) !== 'file') throw new Error('Stock plist is not a regular file.');
                        var parsed = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError($.NSData.dataWithContentsOfFile($(full)), 0, null, null);
                        if (!parsed || parsed.isNil()) throw new Error('Invalid stock plist.');
                        return ObjC.deepUnwrap(parsed);
                    }
                }, options.keychainCatalog);
                report('setup.stock-keychain.prerequisites-verified', result);
                return result;
            },
            kind: kind, directory: directory, names: names,
            permissions: function (relative, mode, owner) {
                report('setup.permissions', {path: relative, mode: mode, owner: owner || null});
                var p = path(relative, false, false);
                if (!/^[0-7]{4}$/.test(mode) || (owner && !/^[0-9]+:[0-9]+$/.test(owner))) throw new Error('Invalid setup permissions.');
                if (owner) run('/usr/sbin/chown', [owner, p]);
                run('/bin/chmod', [mode, p]);
            },
            acl: function (relative, entry) { run('/bin/chmod', ['+a', entry, path(relative, false, false)]); },
            acls: function (relatives, entry) {
                if (!Array.isArray(relatives) || entry !== 'everyone deny delete') throw new Error('Unexpected template ACL batch.');
                // Revalidate each nonlinked path immediately before its bounded
                // batch. This avoids launching a process for every template folder.
                for (var i = 0; i < relatives.length; i += 64) {
                    var targets = relatives.slice(i, i + 64).map(function (relative) { return path(relative, false, false); });
                    run('/bin/chmod', ['+a', entry].concat(targets));
                }
            },
            clearACL: function (relative) { run('/bin/chmod', ['-N', path(relative, false, false)]); },
            touch: function (relative) { run('/usr/bin/touch', [path(relative, false, false)]); },
            hide: function (relative) { run('/usr/bin/chflags', ['-h', 'hidden', path(relative, true, false)]); },
            hideExtension: function (relative) {
                report('setup.hide-extension', {path: relative});
                var e = Ref(), url = $.NSURL.fileURLWithPath($(path(relative, false, false)));
                if (!url.setResourceValueForKeyError($(true), $.NSURLHasHiddenExtensionKey, e)) error(e, 'Cannot set the Finder extension preference.');
            },
            move: function (from, to) {
                report('setup.move', {from: from, to: to});
                var source = path(from, false, false), target = path(to, false, false), e = Ref();
                if (attributes(target)) throw new Error('Setup destination already exists.');
                if (!fm.moveItemAtPathToPathError($(source), $(target), e)) error(e, 'Cannot move setup file.');
            },
            copyFile: function (from, to) {
                report('setup.copy', {from: from, to: to});
                var source = path(from, false, false), target = path(to, false, false), e = Ref();
                if (attributes(source) !== 'file') throw new Error('Setup source must be a regular file.');
                if (attributes(target)) {
                    if (attributes(target) !== 'file') throw new Error('Setup destination must be a regular file.');
                    if (!fm.removeItemAtPathError($(target), e)) error(e, 'Cannot replace setup file.');
                }
                if (!fm.copyItemAtPathToPathError($(source), $(target), e)) error(e, 'Cannot copy setup file.');
            },
            removeEmpty: function (relative) {
                report('setup.remove-empty-directory', {path: relative});
                if (names(relative).length) throw new Error('Refusing to remove a nonempty setup directory.');
                var e = Ref();
                if (!fm.removeItemAtPathError($(path(relative, false, false)), e)) error(e, 'Cannot remove empty setup directory.');
            },
            targetTool: function (program, args) {
                if (program !== '/usr/libexec/makewhatis' || JSON.stringify(args) !== '[]') throw new Error('Unexpected Mavericks setup tool.');
                path(program.slice(1), false, false);
                if (!options || !options.runtime) throw new Error('Private manual-page runtime is unavailable.');
                return options.runtime.run('makewhatis');
            }
        };
    }
    return {create: create};
}());
