/* Rooted information-cache runtime. Fresh images use MacSourceIO's ownership
 * guard. Maintenance must supply its live journal guard and frozen current-tool
 * identity. The helper confines writes to the selected offline filesystem.
 */
var MavericksResurrectionMacImageRuntime = (function () {
    'use strict';
    ObjC.import('Foundation');
    ObjC.bindFunction('kill',['int',['int','int']]);
    function create(stage, validate, hash, resources, diagnostic, cancelled, currentTool) {
        if(currentTool){
            var maintained=currentTool.kind==='journaled-maintenance' && typeof currentTool.assertJournal==='function';
            var installer=currentTool.kind==='private-installer' && typeof currentTool.assertPrivateImage==='function';
            if((!maintained && !installer) || !currentTool.tool || currentTool.tool.path!=='usr/sbin/kextcache' || !/^[a-f0-9]{64}$/.test(currentTool.tool.sha256) || !(currentTool.tool.bytes>0))throw new Error('Current runtime tool identity and journal or private installer guard are required.');
            if(installer && (currentTool.tool.bytes!==197264 || currentTool.tool.sha256!=='bf50f480bc154e232589f685321055f555b126c6a63c39f78d11091e67b474cb'))throw new Error('The original installer cache tool is required.');
        }
        var fm = $.NSFileManager.defaultManager, job = null, prepared = Object.create(null), helperHashes = {};
        function report(event, detail) { try { if (diagnostic) diagnostic(event, detail); } catch (_) {} }
        function guard() { validate(stage); if(currentTool){if(currentTool.kind==='journaled-maintenance')currentTool.assertJournal();else currentTool.assertPrivateImage();} if (cancelled && cancelled()) throw new Error('Private runtime preparation cancelled.'); }
        function attr(p) {
            var a = fm.attributesOfItemAtPathError($(p), null);
            if (!a || a.isNil()) throw new Error('Cannot inspect runtime path: ' + p);
            return a;
        }
        function field(a, k) { return ObjC.unwrap(a.objectForKey($(k))); }
        function regular(p) {
            var canonical = ObjC.unwrap($(p).stringByStandardizingPath.stringByResolvingSymlinksInPath);
            if (canonical !== p || field(attr(p), 'NSFileType') !== 'NSFileTypeRegular') throw new Error('Unexpected linked runtime file: ' + p);
            return p;
        }
        function readJSON(p) {
            regular(p);
            var value = $.NSString.stringWithContentsOfFileEncodingError($(p), $.NSUTF8StringEncoding, null);
            if (!value || value.isNil()) throw new Error('Cannot read runtime catalog.');
            return JSON.parse(ObjC.unwrap(value));
        }
        function permissions(p, mode) {
            if (!fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions: mode, NSFileOwnerAccountID: 0, NSFileGroupOwnerAccountID: 0}), $(p), null)) throw new Error('Cannot protect private runtime file.');
        }
        function command(program, args) {
            guard(); report('runtime.command.started', {program: program, arguments: args});
            var task = $.NSTask.alloc.init;
            var outputPath=job+'/runtime-output-'+ObjC.unwrap($.NSUUID.UUID.UUIDString);
            if(!fm.createFileAtPathContentsAttributes($(outputPath),$.NSData.data,$({NSFilePosixPermissions:384})))throw new Error('Cannot capture private runtime output.');
            var output=$.NSFileHandle.fileHandleForWritingAtPath($(outputPath));
            task.launchPath = $(program); task.arguments = $(args);
            task.environment = $({PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/var/root', LANG: 'C', LC_ALL: 'C'});
            task.standardInput = $.NSFileHandle.fileHandleForReadingAtPath('/dev/null'); task.standardOutput = output; task.standardError = output;
            var interrupted=false,stopTime=0;task.launch;
            while(Boolean(task.running)){
                if(cancelled && cancelled()){if(!interrupted){interrupted=true;stopTime=Date.now();task.terminate;}else if(Date.now()-stopTime>2000)$.kill(Number(task.processIdentifier),9);}
                $.NSThread.sleepForTimeInterval(0.1);
            }
            task.waitUntilExit;output.closeFile;var data=$.NSData.dataWithContentsOfFile($(outputPath));
            fm.removeItemAtPathError($(outputPath),null);
            if(interrupted)throw new Error('Private Mavericks runtime cancelled.');
            var string = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
            var output = string && !string.isNil() ? ObjC.unwrap(string) : '(non-text runtime output)';
            report('runtime.command.finished', {program: program, status: Number(task.terminationStatus), output: output});
            if (Number(task.terminationStatus)) throw new Error('Private Mavericks runtime failed: ' + output.slice(-16000));
            guard(); return {data: data, text: output};
        }
        function copyVerified(source, name, asset) {
            guard(); regular(source);
            if (!asset || !/^[0-9a-f]{64}$/.test(asset.sha256) || Number(field(attr(source), 'NSFileSize')) !== asset.bytes || hash(source) !== asset.sha256) throw new Error('Runtime input differs: ' + name);
            var target = job + '/' + name;
            if (fm.fileExistsAtPath($(target)) || !fm.copyItemAtPathToPathError($(source), $(target), null)) throw new Error('Cannot make a new private runtime copy.');
            permissions(target, 493);
            if (hash(target) !== asset.sha256 || hash(source) !== asset.sha256) throw new Error('Runtime copy changed.');
            return target;
        }
        function prepare(operation) {
            guard();
            if (operation !== 'system-caches' && operation !== 'makewhatis' && operation !== 'dyld-caches') throw new Error('Unexpected private runtime operation.');
            if(currentTool && operation!=='system-caches')throw new Error('Maintenance runtime only rebuilds information caches.');
            if (!job) {
                var parent = attr(stage.job);
                if (field(parent, 'NSFileType') !== 'NSFileTypeDirectory' || Number(field(parent, 'NSFileOwnerAccountID')) !== 0 ||
                    ObjC.unwrap($(stage.job).stringByStandardizingPath.stringByResolvingSymlinksInPath) !== stage.job) throw new Error('Private runtime parent is not owned by the worker.');
                job = stage.job + '/Runtime-' + ObjC.unwrap($.NSUUID.UUID.UUIDString);
                if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(job), false, $({NSFilePosixPermissions: 448, NSFileOwnerAccountID: 0, NSFileGroupOwnerAccountID: 0}), null)) throw new Error('Cannot create private runtime directory.');
                var helpers = readJSON(resources + '/assets/NativeTools.json');
                if (helpers.schema !== 1 || helpers.minimumHost !== '10.10') throw new Error('Unexpected native-tool catalog.');
                ['ImageRuntimeLaunch', 'ImageRuntimeRoot.dylib'].forEach(function (name) {
                    copyVerified(resources + '/BundledTools/' + name, name, helpers.tools[name]);
                    helperHashes[name] = helpers.tools[name].sha256;
                });
            }
            if (!prepared[operation]) {
                var inputs = currentTool ? null : readJSON(resources + '/assets/RuntimeInputs.json');
                var name = operation === 'system-caches' ? 'kextcache' : operation === 'dyld-caches' ? 'update_dyld_shared_cache' : 'makewhatis';
                var relative = operation === 'system-caches' ? 'usr/sbin/kextcache' : operation === 'dyld-caches' ? 'usr/bin/update_dyld_shared_cache' : 'usr/libexec/makewhatis';
                if (!currentTool && (inputs.schema !== 1 || inputs.version !== '10.9.5' || inputs.build !== '13F34' || !inputs.tools[name] || inputs.tools[name].path !== relative)) throw new Error('Unexpected original runtime input.');
                var copy = copyVerified(stage.root + '/' + relative, name, currentTool?currentTool.tool:inputs.tools[name]);
                command('/usr/bin/codesign', ['--force', '--sign', '-', copy]);
                prepared[operation] = {path: copy, sha256: hash(copy)};
            }
            return prepared[operation];
        }
        return {
            run: function (operation) {
                var tool = prepare(operation), root = attr(stage.root);
                if (hash(regular(tool.path)) !== tool.sha256) throw new Error('Private executable copy changed.');
                Object.keys(helperHashes).forEach(function (name) { if (hash(regular(job + '/' + name)) !== helperHashes[name]) throw new Error('Private runtime helper changed.'); });
                var result = command(job + '/ImageRuntimeLaunch', [stage.root,
                    String(field(root, 'NSFileSystemNumber')), String(field(root, 'NSFileSystemFileNumber')),
                    job + '/ImageRuntimeRoot.dylib', tool.path, operation]);
                if (result.text.indexOf('GM_HOST_WRITES_DENIED\n') < 0 || result.text.indexOf('GM_HOST_RUNTIME_ROOTED\n') < 0) throw new Error('The isolated runtime boundary was not confirmed.');
                report('runtime.operation.completed', {operation: operation, image: stage.image});
                return result.data;
            }
        };
    }
    return {create: create};
}());
