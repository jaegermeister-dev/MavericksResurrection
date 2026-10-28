/* Preserve and remove installer scratch data from a private staged image only. */
var MavericksResurrectionMacStageCleanupIO = (function () {
    'use strict';
    ObjC.import('Foundation');
    function create(stage, stageGuard, hash, resources, manifests, diagnostic, privateCacheWork) {
        var fm = $.NSFileManager.defaultManager, archiveRoot = null;
        var allowed = {'private/tmp':true, 'private/var/tmp':true, '.PKInstallSandboxManager':false,
            'System/Library/Caches/com.apple.kernelcaches':false};
        if(privateCacheWork!==undefined){
            if(typeof privateCacheWork!=='string' || !/^private\/var\/tmp\/MavericksResurrection-Cache-[A-Fa-f0-9-]+$/.test(privateCacheWork) ||
                !stage.writable || typeof stage.image!=='string' || stage.image.indexOf(stage.job+'/')!==0 || stage.root.indexOf(stage.job+'/mount-')!==0)
                throw new Error('Installer cache cleanup requires a private image and its exact cache workspace.');
            allowed={};allowed[privateCacheWork]=false;
        }
        function guard() { stageGuard(stage); }
        function report(event, detail) { try { if (diagnostic) diagnostic(event, detail); } catch (_) {} }
        function metadata(full) {
            var a = fm.attributesOfItemAtPathError($(full), null);
            if (!a || a.isNil()) return null;
            function val(key) { return ObjC.unwrap(a.objectForKey(key)); }
            var type = val($.NSFileType);
            return {kind:type===ObjC.unwrap($.NSFileTypeDirectory)?'directory':type===ObjC.unwrap($.NSFileTypeRegular)?'file':type===ObjC.unwrap($.NSFileTypeSymbolicLink)?'symlink':'other',
                mode:Number(val($.NSFilePosixPermissions)),uid:Number(val($.NSFileOwnerAccountID)),gid:Number(val($.NSFileGroupOwnerAccountID)),
                bytes:Number(val($.NSFileSize)), inode:String(val($.NSFileSystemFileNumber)), device:String(val($.NSFileSystemNumber))};
        }
        function path(relative, kind, absentAllowed) {
            guard();
            if (!relative || /[\\\x00-\x1f\x7f]/.test(relative) || relative.split('/').some(function (p) { return !p || p==='.' || p==='..'; })) throw new Error('Unsafe temporary-file path.');
            var current=stage.root,parts=relative.split('/');
            parts.forEach(function (p,i) {
                current+='/'+p; var a=metadata(current),final=i===parts.length-1;
                if (!a && final && absentAllowed) return;
                if (!a || a.kind!==(final?kind:'directory')) throw new Error('Temporary-file path is missing or follows a link.');
            });
            return current;
        }
        function read(full) {
            var s=$.NSString.stringWithContentsOfFileEncodingError($(full),$.NSUTF8StringEncoding,null);
            if (!s || s.isNil()) throw new Error('Cannot read private staging state.');
            return ObjC.unwrap(s);
        }
        function write(full,text) {
            if (metadata(full) || !$(text).writeToFileAtomicallyEncodingError($(full),true,$.NSUTF8StringEncoding,null) ||
                !fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions:384,NSFileOwnerAccountID:0,NSFileGroupOwnerAccountID:0}),$(full),null)) throw new Error('Cannot retain private cleanup evidence.');
        }
        function command(program,args) {
            guard();
            var task=$.NSTask.alloc.init,pipe=$.NSPipe.pipe;
            task.launchPath=$(program);task.arguments=$(args);
            task.environment=$({PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/root',LANG:'C',LC_ALL:'C'});
            task.standardInput=$.NSFileHandle.fileHandleForReadingAtPath('/dev/null');task.standardOutput=pipe;task.standardError=pipe;
            report('cleanup.command.started',{program:program,arguments:args});task.launch;
            var data=pipe.fileHandleForReading.readDataToEndOfFile;task.waitUntilExit;
            var text=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding));
            report('cleanup.command.finished',{program:program,status:Number(task.terminationStatus),outputBytes:Number(data.length)});
            if (Number(task.terminationStatus)) {
                report('cleanup.command.failed',{program:program,output:text.slice(-131072)});
                throw new Error('Preserving staged temporary files failed: '+text.slice(-8192));
            }
            guard();return text;
        }
        function scan(full) {
            var tool=resources+'/BundledTools/TreeManifest',a=metadata(tool),catalog=JSON.parse(read(resources+'/assets/NativeTools.json')).tools.TreeManifest;
            if (!a || a.kind!=='file' || a.bytes!==catalog.bytes || hash(tool)!==catalog.sha256) throw new Error('The private filesystem verifier differs.');
            var rows=command(tool,[full]).trim().split('\n').map(JSON.parse);manifests.validate(rows);return rows;
        }
        function makeArchiveRoot() {
            guard();
            if (archiveRoot) return;
            var owner=metadata(stage.job);
            if (!owner || owner.kind!=='directory' || owner.uid!==0 || (owner.mode&63)!==0 ||
                ObjC.unwrap($(stage.job).stringByStandardizingPath.stringByResolvingSymlinksInPath)!==stage.job ||
                stage.root.indexOf(stage.job+'/')!==0) throw new Error('Cleanup requires the owned root-only stage job.');
            archiveRoot=stage.job+'/preserved-staging-'+ObjC.unwrap($.NSUUID.UUID.UUIDString);
            if (metadata(archiveRoot) || !fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(archiveRoot),false,
                $({NSFilePosixPermissions:448,NSFileOwnerAccountID:0,NSFileGroupOwnerAccountID:0}),null)) throw new Error('Cannot create private preservation folder.');
        }
        function fingerprint(relative) {
            var full=path(relative,'file',false),a=metadata(full);
            return {path:relative,sha256:hash(full),bytes:a.bytes,uid:a.uid,gid:a.gid,mode:a.mode};
        }
        function assertFreshStage() {
            guard();
            var v=$.NSDictionary.dictionaryWithContentsOfFile($(path('System/Library/CoreServices/SystemVersion.plist','file',false)));
            if (!v || v.isNil()) throw new Error('Missing staged version.');
            v=ObjC.deepUnwrap(v);
            if (v.ProductVersion!=='10.9.5' || v.ProductBuildVersion!=='13F34' || fm.fileExistsAtPath($(stage.root+'/private/var/db/.AppleSetupDone'))) throw new Error('Cleanup is restricted to a fresh Mavericks image.');
        }
        return {
            assertFreshStage:assertFreshStage,
            captureProtectedFiles:function (setup) {
                assertFreshStage();
                var first='Library/Application Support/MavericksResurrection/FirstBoot/';
                var expected={
                    'mach_kernel':'7910ba5869a70b245c6edb9990826bc64394ebe532050843138cf24b301c5fd0',
                    'System/Library/CoreServices/boot.efi':setup.boot.bootEFI.sha256,
                    'System/Library/Caches/com.apple.kext.caches/Startup/kernelcache':setup.caches.kernelcacheSHA256
                };
                expected[first+'FirstBootSetup']=setup.runtime.firstBoot.helperSHA256;
                Object.keys(setup.caches.informationCaches).forEach(function (p) {
                    if (['System/Library/Caches/com.apple.kext.caches/Startup/IOKitPersonalities_x86_64.ioplist.gz',
                        'System/Library/Caches/com.apple.kext.caches/Startup/KextPropertyValues_OSBundleHelper_x86_64.plist.gz'].indexOf(p)<0) throw new Error('Unexpected information-cache path.');
                    expected[p]=setup.caches.informationCaches[p];
                });
                if (Object.keys(expected).length!==6) throw new Error('Both verified information caches are required.');
                Object.keys(expected).forEach(function (p) { if (!/^[a-f0-9]{64}$/.test(expected[p])) throw new Error('Missing prepared boot input identity.'); });
                var state=JSON.parse(read(path(first+'State.json','file',false)));
                if (state.installID!==setup.runtime.firstBoot.installID || state.phase!=='pending' || state.steps.length!==setup.runtime.firstBoot.steps.length ||
                    state.steps.some(function (s) { return s.status!=='pending' || s.attempts!==0; })) throw new Error('The prepared first-boot state differs.');
                return Object.keys(expected).concat([first+'State.json','Library/LaunchDaemons/local.mavericksresurrection.firstboot.plist',
                    'Library/LaunchAgents/local.mavericksresurrection.firstboot-notice.plist','System/Library/CoreServices/SystemVersion.plist',
                    'System/Library/CoreServices/PlatformSupport.plist','Library/Preferences/SystemConfiguration/com.apple.Boot.plist']).map(function (p) {
                        var r=fingerprint(p);if (expected[p] && r.sha256!==expected[p]) throw new Error('A prepared boot input changed before cleanup.');return r;
                    });
            },
            verifyProtectedFiles:function (rows) {
                rows.forEach(function (before) { if (JSON.stringify(fingerprint(before.path))!==JSON.stringify(before)) throw new Error('Cleanup changed a prepared boot input.'); });
            },
            archiveAndClean:function (relative,contentsOnly) {
                if (!Object.prototype.hasOwnProperty.call(allowed,relative) || allowed[relative]!==contentsOnly) throw new Error('Cleanup path is not an installer scratch location.');
                var full=path(relative,'directory',true),a=metadata(full);
                if (!a) return null;
                var names=ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError($(full),null));
                if (!Array.isArray(names)) throw new Error('Cannot inspect temporary files.');
                if (contentsOnly && !names.length) return null;
                makeArchiveRoot();
                var leaf=relative.replace(/\//g,'_'),destination=archiveRoot+'/'+leaf;
                if (metadata(destination)) throw new Error('Preservation destination exists.');
                var before=scan(full);
                command('/usr/bin/ditto',['--rsrc','--extattr','--acl',full,destination]);
                // Preserve the original root mode explicitly; prior native copy
                // tests showed ditto dropping sticky bits on HFS+ directories.
                if (!fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions:a.mode,NSFileOwnerAccountID:a.uid,NSFileGroupOwnerAccountID:a.gid}),$(destination),null)) throw new Error('Cannot preserve temporary-directory permissions.');
                var verification=manifests.compare(before,scan(destination));
                manifests.compare(before,scan(full));
                write(archiveRoot+'/'+leaf+'.manifest.jsonl',before.map(function (row) { return JSON.stringify(row); }).join('\n')+'\n');
                guard();
                if (metadata(full).device!==a.device || metadata(full).inode!==a.inode) throw new Error('Temporary directory changed before cleanup.');
                if (contentsOnly) {
                    names.forEach(function (name) {
                        if (!name || name==='.' || name==='..' || /[\/\\\x00-\x1f\x7f]/.test(name)) throw new Error('Unsafe temporary entry name.');
                        guard();
                        if (!fm.removeItemAtPathError($(full+'/'+name),null)) throw new Error('Cannot remove preserved temporary entry.');
                    });
                    var after=ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError($(full),null));
                    if (!Array.isArray(after) || after.length || metadata(full).mode!==a.mode || metadata(full).uid!==a.uid || metadata(full).gid!==a.gid) throw new Error('Temporary directory cleanup did not verify.');
                } else {
                    if (!fm.removeItemAtPathError($(full),null) || metadata(full)) throw new Error('Cannot remove preserved installer staging directory.');
                }
                var result={path:relative,contentsOnly:contentsOnly,archive:destination,readbackVerified:true,removalVerified:true,
                    entries:verification.entries,logicalFileBytes:verification.logicalFileBytes};
                write(archiveRoot+'/'+leaf+'.receipt.json',JSON.stringify(result,null,2)+'\n');
                report('cleanup.preservation.verified',result);return result;
            }
        };
    }
    return {create:create};
}());
