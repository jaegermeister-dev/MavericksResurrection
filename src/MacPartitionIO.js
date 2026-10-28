/* Native single-partition formatting and mounting. No partition-map writer.
 * Public factory always uses the physical-target policy; image fixtures replace
 * that dependency inside their isolated test context, never in app resources. */
var MavericksResurrectionMacPartitionIO = (function () {
    'use strict';
    ObjC.import('Foundation');
    function create(io, runtime, resources, job, protectedPaths, retainedIDs, diagnostic, workflow) {
        workflow=workflow || 'direct';
        if(workflow!=='direct')throw new Error('Unknown partition deployment workflow.');
        if (ObjC.unwrap($.NSUserName()) !== 'root') throw new Error('Administrator authorization is required.');
        var fm = $.NSFileManager.defaultManager, jobStat = io.stat(job), stage = null, binding = null, rootID = null, readOnly = false;
        if (jobStat.kind !== 'directory' || jobStat.uid !== 0 || jobStat.mode !== 448 ||
            ObjC.unwrap($(job).stringByStandardizingPath.stringByResolvingSymlinksInPath) !== job) throw new Error('A private deployment workspace is required.');
        var paths = [resources, job].concat(protectedPaths || []).filter(function(p,i,a){return a.indexOf(p)===i;}), ids = (retainedIDs || []).slice();
        var protectedDevices = {};
        function report(e, d) { try { if (diagnostic) diagnostic(e, d); } catch (_) {} }
        function jobGuard() { var s=io.stat(job); if (s.identity !== jobStat.identity || s.kind !== 'directory' || s.uid !== 0 || s.mode !== 448) throw new Error('Deployment workspace changed.'); }
        function command(program, args) {
            jobGuard();
            var t = $.NSTask.alloc.init, pipe = $.NSPipe.pipe;
            t.launchPath = $(program); t.arguments = $(args);
            t.environment = $({PATH:'/usr/bin:/bin:/usr/sbin:/sbin', HOME:'/var/root', LANG:'C', LC_ALL:'C'});
            t.standardInput = $.NSFileHandle.fileHandleForReadingAtPath('/dev/null'); t.standardOutput = pipe; t.standardError = pipe;
            report('destination.command.started', {program:program, arguments:args}); t.launch;
            var data = pipe.fileHandleForReading.readDataToEndOfFile; t.waitUntilExit;
            var text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
            report('destination.command.finished', {program:program, status:Number(t.terminationStatus), output:text});
            if (Number(t.terminationStatus)) throw new Error('Destination operation failed: ' + text);
            jobGuard(); return text;
        }
        var releaseSource=$.NSString.stringWithContentsOfFileEncodingError($(resources+'/src/VolumeRelease.js'),$.NSUTF8StringEncoding,null);
        if(!releaseSource||releaseSource.isNil())throw new Error('Missing volume-release support.');
        var release=Function(ObjC.unwrap(releaseSource)+'\nreturn MavericksResurrectionVolumeRelease;')().createNative(io,runtime,job,jobGuard,command,MavericksPolicy,report);
        function protectedVolumes() {
            var rootFilesystem = io.stat('/').identity.split(':')[0];
            var result = ids.slice(), root = protectedDevices[rootFilesystem] || (protectedDevices[rootFilesystem] = runtime.info('/').DeviceIdentifier);
            if (result.indexOf(root) < 0) result.push(root);
            paths.forEach(function(p) { var filesystem=io.stat(p).identity.split(':')[0];var d=protectedDevices[filesystem]||(protectedDevices[filesystem]=runtime.volumeForPath(p));if(result.indexOf(d)<0)result.push(d); });
            return result;
        }
        function snapshot(request) {
            jobGuard();
            var selected = request && request.approval && request.approval.target;
            if (!selected || !/^disk[0-9]+s[0-9]+$/.test(selected.bsd) || !/^disk[0-9]+$/.test(selected.parent) || selected.bsd.replace(/s[0-9]+$/, '') !== selected.parent) throw new Error('Invalid selected partition identity.');
            var info = runtime.info('/dev/' + selected.bsd), whole = runtime.info('/dev/' + selected.parent);
            var list = runtime.plist('/usr/sbin/diskutil', ['list', '-plist', '/dev/' + selected.parent]);
            if (!list || !Array.isArray(list.AllDisksAndPartitions) || list.AllDisksAndPartitions.length !== 1 || list.AllDisksAndPartitions[0].DeviceIdentifier !== selected.parent) throw new Error('Cannot verify the complete selected disk map.');
            var records = list.AllDisksAndPartitions[0].Partitions;
            if (!Array.isArray(records) || !records.length) throw new Error('The selected disk has no verifiable partitions.');
            var found = 0, layout = records.map(function(r) {
                if (!/^disk[0-9]+s[0-9]+$/.test(r.DeviceIdentifier) || r.DeviceIdentifier.replace(/s[0-9]+$/, '') !== selected.parent) throw new Error('Unexpected disk-map entry.');
                var p = r.DeviceIdentifier === selected.bsd ? info : runtime.info('/dev/' + r.DeviceIdentifier);
                if (p.DeviceIdentifier === selected.bsd) found++;
                return {bsd:p.DeviceIdentifier, uuid:p.DiskUUID || '', offset:p.PartitionMapPartitionOffset,
                    size:MavericksPolicy.capacity(p), content:p.Content,
                    siblingVolume:p.DeviceIdentifier === selected.bsd ? null : p.VolumeUUID || null};
            });
            if (found !== 1) throw new Error('The selected partition is missing from its disk map.');
            return {info:info, whole:whole, protectedIDs:protectedVolumes(), layout:layout,
                parent:{bsd:whole.DeviceIdentifier, size:MavericksPolicy.capacity(whole), content:whole.Content,
                    protocol:whole.BusProtocol, internal:whole.Internal, media:whole.MediaName || '',
                    tree:whole.DeviceTreePath || '', uuid:whole.DiskUUID || ''}};
        }
        function requestFor(info) { return {approval:{target:MavericksPolicy.identity(info)}}; }
        function sameDisk(a, b) {
            if (!MavericksPolicy.unchanged(MavericksPolicy.identity(a.info), MavericksPolicy.identity(b.info), false) ||
                JSON.stringify(a.parent) !== JSON.stringify(b.parent) || JSON.stringify(a.layout) !== JSON.stringify(b.layout)) throw new Error('Selected disk identity changed.');
        }
        function guard(given) {
            jobGuard();
            if (!stage || given !== stage || stage.root !== job + '/destination' || stage.device !== '/dev/' + binding.info.DeviceIdentifier || stage.writable === readOnly ||
                io.stat(stage.root).kind !== 'directory' || io.stat(stage.root).identity !== rootID) throw new Error('Mounted destination identity changed.');
        }
        guard.revalidate = function() {
            guard(stage);
            var fresh = {info:runtime.info(stage.device)};
            if (!MavericksPolicy.unchanged(MavericksPolicy.identity(binding.info), MavericksPolicy.identity(fresh.info), false)) throw new Error('Selected partition identity changed.');
            if (fresh.info.MountPoint !== stage.root || fresh.info.GlobalPermissionsEnabled !== true || fresh.info.WritableVolume !== !readOnly || !MavericksPolicy.isJournaledHFS(fresh.info)) throw new Error('Destination mount or ownership mode changed.');
            var prefix=stage.device+' on '+stage.root+' (', mounts=command('/sbin/mount',[]).split('\n').filter(function(line){return line.indexOf(prefix)===0 && line.slice(-1)===')';});
            if(mounts.length!==1)throw new Error('Cannot verify the destination mount flags.');
            var flags=mounts[0].slice(prefix.length,-1).split(', ');
            // Match hdiutil's private-image mount semantics. On Tahoe, ditto
            // strips source set-id bits when crossing from a nosuid source to a
            // suid destination. Keep execution restrictions on both filesystems.
            if(flags.indexOf('nosuid')<0 || flags.indexOf('nodev')<0 || flags.indexOf('nobrowse')<0 || (flags.indexOf('read-only')>=0)!==readOnly)throw new Error('Destination mount restrictions changed.');
            var protectedIDs=protectedVolumes();
            if (protectedIDs.indexOf(fresh.info.DeviceIdentifier) >= 0 || protectedIDs.indexOf(binding.parent.bsd) >= 0) throw new Error('The destination now contains a protected app file.');
        };
        function mounted(readonly) {
            var fresh = {info:runtime.info('/dev/' + binding.info.DeviceIdentifier)};
            if (!MavericksPolicy.unchanged(MavericksPolicy.identity(binding.info), MavericksPolicy.identity(fresh.info), false)) throw new Error('Selected partition identity changed.');
            if (fresh.info.Mounted === true || fresh.info.MountPoint) throw new Error('Destination is already mounted elsewhere.');
            command('/sbin/mount_hfs', ['-o', (readonly ? 'rdonly,' : '') + 'nobrowse,owners,nosuid,nodev', '/dev/' + binding.info.DeviceIdentifier, job + '/destination']);
            readOnly = readonly;
            stage = {root:job + '/destination', job:job, device:'/dev/' + binding.info.DeviceIdentifier, writable:!readonly, enforceOwners:true};
            rootID = io.stat(stage.root).identity; guard.revalidate(); return stage;
        }
        function unmount() {
            if (!stage) return;
            guard.revalidate(); release.unmount(binding.info); stage = null; rootID = null;
        }
        return {
            snapshot:snapshot,
            preflightSource:function(p) {
                io.progress('verify-source-before-format', 'Checking the prepared Mavericks image before formatting.');
                paths.push(p.image.path, p.manifest);
                var before = io.stat(p.image.path);
                if (before.kind !== 'file' || before.bytes !== p.image.bytes || io.sha256(p.image.path) !== p.image.sha256 || JSON.stringify(before) !== JSON.stringify(io.stat(p.image.path)) ||
                    io.stat(p.manifest).kind !== 'file' || io.sha256(p.manifest) !== p.manifestSHA256) throw new Error('The prepared source changed before formatting.');
                var source = io.attach(p.image.path, job, 'preflight', false, true);
                try { io.readOnlyMountGuard(source).revalidate(); } finally { io.detach(source); }
                protectedVolumes();
            },
            formatSelected:function(plan, before) {
                var fresh = snapshot(requestFor(before.info)); sameDisk(before, fresh);
                var reason = MavericksPolicy.targetReason(fresh.info, fresh.whole, fresh.protectedIDs, workflow);
                if (reason) throw new Error(reason);
                if (MavericksPolicy.freeSpace(fresh.info) === null || fresh.info.VolumeName !== plan.volumeName ||
                    !MavericksPolicy.unchanged(plan.target, MavericksPolicy.identity(fresh.info), false) ||
                    plan.workflow !== workflow || plan.format.executable !== '/usr/sbin/diskutil' || JSON.stringify(plan.format.arguments) !== JSON.stringify(['eraseVolume','JHFS+',fresh.info.VolumeName,'/dev/' + fresh.info.DeviceIdentifier])) throw new Error('The confirmed format plan changed.');
                // progress checks the cancellation marker. Keep this after the
                // potentially slow disk refresh and next to the format command.
                io.progress('format-partition', 'Formatting the confirmed partition as Mac OS Extended (Journaled).');
                release.run(fresh.info,function(){io.progress('format-partition','Formatting the confirmed partition as Mac OS Extended (Journaled).');return command('/usr/sbin/diskutil', ['eraseVolume', 'JHFS+', fresh.info.VolumeName, '/dev/' + fresh.info.DeviceIdentifier]);},true);
            },
            openFormatted:function(after) {
                if (binding || stage) throw new Error('Destination already bound.');
                // The caller has just checked the complete post-format layout.
                var fresh=after, live=runtime.info('/dev/' + after.info.DeviceIdentifier);
                if (!MavericksPolicy.unchanged(MavericksPolicy.identity(after.info), MavericksPolicy.identity(live), false)) throw new Error('Formatted partition identity changed.');
                fresh.info=live;
                var reason = MavericksPolicy.targetReason(fresh.info, fresh.whole, fresh.protectedIDs, workflow);
                if (reason) throw new Error(reason);
                binding = fresh;
                if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(job + '/destination'), false, $({NSFilePosixPermissions:448}), null)) throw new Error('Cannot create the private destination mountpoint.');
                if (fresh.info.MountPoint) release.unmount(fresh.info);
                mounted(false);
                return {
                    current:function(){return stage;}, guard:function(){return guard;},
                    assertEmpty:function(){guard(stage); var permitted=['.fseventsd','.Spotlight-V100','.Trashes','.TemporaryItems']; if(io.directoryNames(stage.root).some(function(n){return permitted.indexOf(n)<0;}))throw new Error('The formatted destination is not empty.');},
                    readOnly:function(){unmount(); return mounted(true);},
                    close:unmount,
                    identity:function(){return MavericksPolicy.identity(binding.info);}
                };
            },
            record:function(state) {
                jobGuard();
                var path = job + '/DEPLOYMENT-STATE.json';
                if (!$(JSON.stringify(state, null, 2) + '\n').writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, null) ||
                    !fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions:384,NSFileOwnerAccountID:0,NSFileGroupOwnerAccountID:0}),$(path),null)) throw new Error('Cannot preserve the installation state.');
            },
            close:function(){try{unmount();}finally{release.restore();}}
        };
    }
    return {create:create};
}());
