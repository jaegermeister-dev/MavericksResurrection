/* macOS-only Foundation bridge. Discovery commands are an explicit read-only set. */
var MavericksMacRuntime = (function () {
    'use strict';
    ObjC.import('Foundation');
    var diagnostic = null;
    function report(event, detail) { try { if (diagnostic) diagnostic(event, detail); } catch (_) {} }
    var allowed = {
        '/usr/sbin/diskutil': ['list', 'info'],
        '/usr/bin/hdiutil': ['info'],
        '/usr/sbin/system_profiler': ['-xml'],
        '/usr/sbin/sysctl': ['-n'],
        '/usr/sbin/ioreg': ['-rd1', '-a'],
        '/usr/bin/sw_vers': ['-productVersion'],
        '/usr/bin/uname': ['-m'],
        '/bin/df': ['-P'],
        '/sbin/mount': ['-t']
    };
    function text(data) {
        var value = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
        if (!value || value.isNil()) throw new Error('A command did not return UTF-8 text.');
        return ObjC.unwrap(value);
    }
    function command(executable, args) {
        if (!allowed[executable] || allowed[executable].indexOf(args[0]) < 0) throw new Error('This probe only permits read-only discovery commands.');
        if (executable === '/sbin/mount' && (args.length !== 2 || args[0] !== '-t' || args[1] !== 'nullfs')) throw new Error('Only listing nullfs mounts is permitted.');
        report('discovery.command.started', {program: executable, arguments: args});
        var task = $.NSTask.alloc.init, pipe = $.NSPipe.pipe;
        task.launchPath = $(executable);
        task.arguments = $(args);
        task.environment = $({PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C'});
        task.standardInput = $.NSFileHandle.fileHandleForReadingAtPath('/dev/null');
        task.standardOutput = pipe;
        task.standardError = pipe;
        task.launch;
        // Drain before waiting so output larger than a pipe buffer cannot deadlock.
        var output = pipe.fileHandleForReading.readDataToEndOfFile;
        task.waitUntilExit;
        var decoded = text(output), status = Number(task.terminationStatus);
        report('discovery.command.finished', {program: executable, status: status, output: decoded});
        if (status !== 0) throw new Error(executable + ' exited with ' + status + ': ' + decoded);
        return {text: decoded, data: output};
    }
    function plist(executable, args) {
        var result = command(executable, args), error = Ref();
        var value = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(result.data, 0, null, error);
        if (!value || value.isNil()) throw new Error('Unable to read a macOS discovery property list.');
        return ObjC.deepUnwrap(value);
    }
    function info(device) { return plist('/usr/sbin/diskutil', ['info', '-plist', device]); }
    function volumeForPath(path, probe) {
        probe = probe || command;
        var original = path, visited = [];
        function absolute(value) { return typeof value === 'string' && value.charAt(0) === '/' && !/[\x00\n\r]/.test(value); }
        function canonical(value) { return value.replace(/^\/var\//, '/private/var/'); }
        for (var depth = 0; depth < 8; depth++) {
            if (!absolute(path)) throw new Error('A protected path must be absolute.');
            if (visited.indexOf(path) >= 0) break;
            visited.push(path);
            var output = probe('/bin/df', ['-P', path]).text.split('\n'), devices = [];
            for (var i = 1; i < output.length; i++) {
                var match = output[i].match(/^\/dev\/(disk[0-9]+(?:s[0-9]+)+)\s/);
                if (match) devices.push(match[1]);
            }
            if (devices.length === 1) return devices[0];
            if (devices.length > 1) break;
            // App Translocation exposes the original .app as a read-only nullfs
            // mount. Protect its original disk, not merely its temporary path.
            // Confirm the same source/mount pair in both read-only OS reports;
            // never guess a disk or skip protection when resolution fails.
            var mounts = probe('/sbin/mount', ['-t', 'nullfs']).text.split('\n'), sources = [];
            mounts.forEach(function (line) {
                var flags = line.lastIndexOf(' (nullfs');
                if (flags < 0 || !/^[,) ]/.test(line.slice(flags + 8))) return;
                var pair = line.slice(0, flags), separator = pair.lastIndexOf(' on ');
                if (separator < 0) return;
                var source = pair.slice(0, separator), mount = pair.slice(separator + 4);
                if (!absolute(source) || !/\.app$/.test(source) || !absolute(mount) ||
                    !/\/AppTranslocation\/[0-9a-fA-F-]+$/.test(mount)) return;
                var current = canonical(path), mounted = canonical(mount);
                if (current !== mounted && current.indexOf(mounted + '/') !== 0) return;
                var confirmed = output.slice(1).some(function (row) {
                    if (row.slice(0, source.length) !== source || row.slice(-mount.length) !== mount) return false;
                    return /^\s+\d+\s+\d+\s+\d+\s+\d+%\s+$/.test(row.slice(source.length, -mount.length));
                });
                if (confirmed && sources.indexOf(source) < 0) sources.push(source);
            });
            if (sources.length !== 1) break;
            report('discovery.translocation.resolved', {path: path, source: sources[0]});
            path = sources[0];
        }
        throw new Error('Could not identify the volume containing a protected source or workspace: ' + original + '. Move the app to a local folder and reopen it, or reconnect the drive containing this path.');
    }
    function inventory(protectedPaths, retainedProtectedIDs) {
        var host = {
            model: command('/usr/sbin/sysctl', ['-n', 'hw.model']).text.trim(),
            version: command('/usr/bin/sw_vers', ['-productVersion']).text.trim(),
            architecture: command('/usr/bin/uname', ['-m']).text.trim()
        };
        var registry = command('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']).text;
        var match = registry.match(/"board-id"\s*=\s*<"(Mac-[0-9A-Fa-f]+)"/);
        host.board = match ? match[1] : '';
        var root = info('/'), protectedIDs = [root.DeviceIdentifier];
        // Diagnostic files may be on removable media. Retain the already
        // resolved IDs without touching a lost log path during later discovery.
        (retainedProtectedIDs || []).forEach(function (id) {
            if (typeof id !== 'string' || !/^disk[0-9]+(?:s[0-9]+)+$/.test(id)) throw new Error('Invalid retained protected volume identity.');
            if (protectedIDs.indexOf(id) < 0) protectedIDs.push(id);
        });
        protectedPaths.forEach(function (path) {
            var device = volumeForPath(path);
            if (protectedIDs.indexOf(device) < 0) protectedIDs.push(device);
        });
        // Yosemite does not have the later `physical` list filter. Enumerate all
        // disks, explicitly exclude attached disk-image entities, then let the
        // partition policy verify each physical parent and reject logical disks.
        var listed = plist('/usr/sbin/diskutil', ['list', '-plist']);
        if (!Array.isArray(listed.AllDisksAndPartitions)) throw new Error('Disk inventory is incomplete.');
        var attached = plist('/usr/bin/hdiutil', ['info', '-plist']), imageDisks = [];
        if (!attached || !Array.isArray(attached.images)) throw new Error('Disk-image inventory is incomplete.');
        attached.images.forEach(function (image) {
            (image['system-entities'] || []).forEach(function (entity) {
                var device = String(entity['dev-entry'] || '').match(/^\/dev\/(disk[0-9]+)(?:s[0-9]+)*$/);
                if (device && imageDisks.indexOf(device[1]) < 0) imageDisks.push(device[1]);
            });
        });
        var disks = [], partitions = [], internals = [];
        listed.AllDisksAndPartitions.forEach(function (record) {
            if (!/^disk[0-9]+$/.test(record.DeviceIdentifier) || imageDisks.indexOf(record.DeviceIdentifier) >= 0) return;
            var whole = info('/dev/' + record.DeviceIdentifier);
            disks.push(whole);
            if (whole.Internal === true) internals.push(whole.DeviceIdentifier);
            (record.Partitions || []).forEach(function (partition) {
                if (partition.Content !== 'Apple_HFS') return;
                var item = info('/dev/' + partition.DeviceIdentifier);
                partitions.push({info: item, whole: whole});
            });
        });
        var storage = {}, storageErrors = [];
        // A missing NVMe reporter on an older host must not discard valid SATA
        // evidence or be interpreted as evidence that an unknown disk is SATA.
        ['SPNVMeDataType', 'SPSerialATADataType'].forEach(function (category) {
            try {
                var result = MavericksPolicy.storageCategories(plist('/usr/sbin/system_profiler',
                    ['-xml', category, '-detailLevel', 'basic', '-timeout', '20']));
                if (result[category]) storage[category] = result[category];
                else storageErrors.push(category + ': no report available');
            } catch (error) { storageErrors.push(category + ': ' + String(error)); }
        });
        var nvmeControllers = [], nvmeProbeError = '';
        try { nvmeControllers = plist('/usr/sbin/ioreg', ['-a', '-r', '-c', 'IONVMeController', '-l']); }
        catch (error) { nvmeProbeError = String(error); }
        return {host: host, nvmeControllers: nvmeControllers, nvmeProbeError: nvmeProbeError, disks: disks, partitions: partitions, protectedIDs: protectedIDs,
            internalDisks: internals, storageReport: storage, storageError: storageErrors.join('\n')};
    }
    return {command: command, plist: plist, info: info, volumeForPath: volumeForPath, inventory: inventory,
        setDiagnostic: function (callback) { diagnostic = callback; }};
}());
