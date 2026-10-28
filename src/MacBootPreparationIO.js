/* Boot records for a new HFS+ system. Caller supplies the bound image/partition
 * guard; no startup-disk, NVRAM or partition-map change is performed here. */
var MavericksResurrectionMacBootPreparationIO = (function () {
    'use strict';
    ObjC.import('Foundation');
    function create(stage, stageGuard, hash, diagnostic) {
        var fm = $.NSFileManager.defaultManager, folder = 'System/Library/CoreServices';
        function guard() { stageGuard(stage); }
        function report(event, detail) { try { if (diagnostic) diagnostic(event, detail); } catch (_) {} }
        function metadata(full) {
            var a = fm.attributesOfItemAtPathError($(full), null);
            if (!a || a.isNil()) return null;
            function value(key) { return ObjC.unwrap(a.objectForKey(key)); }
            var type = value($.NSFileType);
            return {kind: type === ObjC.unwrap($.NSFileTypeDirectory) ? 'directory' : type === ObjC.unwrap($.NSFileTypeRegular) ? 'file' : 'other',
                mode: Number(value($.NSFilePosixPermissions)), uid: Number(value($.NSFileOwnerAccountID)), gid: Number(value($.NSFileGroupOwnerAccountID)),
                bytes: Number(value($.NSFileSize)), id: Number(value($.NSFileSystemFileNumber))};
        }
        function path(relative, kind, absentAllowed) {
            guard();
            if (!relative || /[\\\x00-\x1f\x7f]/.test(relative) || relative.split('/').some(function (p) { return !p || p === '.' || p === '..'; })) throw new Error('Invalid boot preparation path.');
            var current = stage.root, parts = relative.split('/');
            parts.forEach(function (part, i) {
                current += '/' + part;
                var a = metadata(current), final = i === parts.length - 1;
                if (!a && final && absentAllowed) return;
                if (!a || a.kind !== (final ? kind : 'directory')) throw new Error('Boot path is missing or follows a link: ' + relative);
            });
            return current;
        }
        function plist(full) {
            var value = $.NSDictionary.dictionaryWithContentsOfFile($(full));
            if (!value || value.isNil()) throw new Error('Cannot read a boot preparation property list.');
            return ObjC.deepUnwrap(value);
        }
        function verifyFile(relative, expectedHash, bytes) {
            var full = path(relative, 'file', false), a = metadata(full);
            if (a.bytes !== bytes || a.uid !== 0 || a.gid !== 0 || a.mode !== 420 || hash(full) !== expectedHash) throw new Error('Original Mavericks EFI loader identity or permissions differ.');
        }
        function bless(args) {
            guard();
            var task = $.NSTask.alloc.init, pipe = $.NSPipe.pipe;
            task.launchPath = '/usr/sbin/bless'; task.arguments = $(args);
            task.environment = $({PATH:'/usr/bin:/bin:/usr/sbin:/sbin', HOME:'/var/root', LANG:'C', LC_ALL:'C'});
            task.standardInput = $.NSFileHandle.fileHandleForReadingAtPath('/dev/null');
            task.standardOutput = pipe; task.standardError = pipe;
            report('boot.command.started', {program:'/usr/sbin/bless', arguments:args});
            task.launch; var data = pipe.fileHandleForReading.readDataToEndOfFile; task.waitUntilExit;
            var text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
            report('boot.command.finished', {status:Number(task.terminationStatus), output:text});
            if (Number(task.terminationStatus)) throw new Error('Setting Mavericks boot records failed: ' + text);
            guard(); return data;
        }
        return {
            assertPrivateStage: guard,
            verifySystem: function () {
                var version = plist(path(folder + '/SystemVersion.plist', 'file', false));
                var options = plist(path('Library/Preferences/SystemConfiguration/com.apple.Boot.plist', 'file', false));
                if (version.ProductVersion !== '10.9.5' || version.ProductBuildVersion !== '13F34' ||
                    JSON.stringify(Object.keys(options)) !== '["Kernel Flags"]' || options['Kernel Flags'] !== '') throw new Error('Expected a fresh Mavericks system with stock boot options.');
                if (fm.fileExistsAtPath($(stage.root + '/private/var/db/.AppleSetupDone'))) throw new Error('This is not a fresh Mavericks setup image.');
            },
            verifyFile: verifyFile,
            installLoader: function (from, to, expectedHash, bytes) {
                if (from !== 'usr/standalone/i386/boot.efi' || to !== folder + '/boot.efi') throw new Error('Unexpected EFI loader copy.');
                verifyFile(from, expectedHash, bytes);
                var source = path(from, 'file', false), target = path(to, 'file', true);
                if (metadata(target)) { verifyFile(to, expectedHash, bytes); return; }
                report('boot.loader.copy', {source:from, destination:to});
                if (!fm.copyItemAtPathToPathError($(source), $(target), null) ||
                    !fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions:420, NSFileOwnerAccountID:0, NSFileGroupOwnerAccountID:0}), $(target), null)) throw new Error('Cannot install the original Mavericks EFI loader.');
                verifyFile(to, expectedHash, bytes);
            },
            bless: function (systemFolder, loader) {
                if (systemFolder !== folder || loader !== folder + '/boot.efi') throw new Error('Unexpected boot record selection.');
                var directory = path(systemFolder, 'directory', false), file = path(loader, 'file', false);
                // --file records this existing target loader. No --bootefi copy
                // fallback, --setBoot, NVRAM, EFI partition or APFS operation.
                bless(['--folder', directory, '--file', file, '--verbose']);
                if (!fm.setAttributesOfItemAtPathError($({NSFileImmutable:true}), $(file), null)) throw new Error('Cannot preserve the native EFI loader lock flag.');
                var data = bless(['--info', stage.root, '--plist']);
                var value = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, null);
                if (!value || value.isNil()) throw new Error('Cannot inspect the staged HFS+ boot records.');
                return {root:stage.root, info:ObjC.deepUnwrap(value), ids:{folder:metadata(directory).id, file:metadata(file).id}};
            }
        };
    }
    return {create:create};
}());
