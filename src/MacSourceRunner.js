/* Native progress window for the unprivileged source worker.
 * IPC files are private temporary state, not end-user log files.
 */
var MavericksMacSourceRunner = (function () {
    'use strict';
    ObjC.import('AppKit');
    ObjC.import('Foundation');
    var active = null, presenter = null;
    function write(path, text) {
        var error = Ref();
        if (!$(text).writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, error)) throw new Error('Cannot write source-worker state.');
    }
    function cancel() {
        if (!active || active.cancelled) return;
        write(active.cancelPath, 'cancel\n');
        active.cancelled = true;
        active.presentation.stopping(active.advanced ? 'Stopping at the next safe boundary. Reports already collected will be kept; any started graphics change will finish or restore its saved state.' : active.cleaning ? 'Mavericks installation succeeded. Checking whether DMG deletion has already completed.' : active.collecting ? 'Stopping diagnostic collection. Your Mavericks installation is unchanged.' : active.maintaining ? 'Stopping after the current maintenance step. A started driver change will finish or restore the preceding driver and cache state.' : active.deploying ? 'Stopping after the current disk operation. The selected partition may already be formatted or partly installed. If an administrator prompt is open, you can cancel that prompt.' : active.preparingSystem ? 'Stopping after the current preparation operation. Prepared files will be retained. If an administrator prompt is open, you can cancel that prompt.' : 'Stopping after the current image operation. Your partial download will be retained.');
    }
    ObjC.registerSubclass({name: 'MavericksSourceProgressDelegate', superclass: 'NSObject', methods: {
        'cancelSource:': {types: ['void', ['id']], implementation: function () { cancel(); }}
    }});
    function createIPC() {
        var base = ObjC.unwrap($.NSTemporaryDirectory().stringByResolvingSymlinksInPath).replace(/\/$/, '');
        var pipe = $.NSPipe.pipe, task = $.NSTask.alloc.init;
        task.launchPath = $('/usr/bin/mktemp'); task.arguments = $(['-d', base + '/Mavericks-App-IPC-XXXXXXXX']);
        task.standardOutput = pipe; task.launch;
        var bytes = pipe.fileHandleForReading.readDataToEndOfFile;
        task.waitUntilExit;
        if (Number(task.terminationStatus) !== 0) throw new Error('Cannot create the private worker communication folder.');
        var root = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)).trim();
        if (root.indexOf(base + '/Mavericks-App-IPC-') !== 0 || root.slice(base.length + 1).indexOf('/') !== -1) throw new Error('Unexpected worker communication path.');
        return root;
    }
    function textField(rect, text) {
        var field = $.NSTextField.alloc.mrInitWithXYWidthHeight(rect.origin.x, rect.origin.y, rect.size.width, rect.size.height);
        field.stringValue = $(text); field.editable = false; field.selectable = true;
        field.bezeled = false; field.drawsBackground = false;
        field.cell.wraps = true;
        return field;
    }
    function windowFor(state,resources) {
        function read(name){return ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(resources+'/src/'+name+'.js'),$.NSUTF8StringEncoding,null));}
        var format=Function(read('ProgressPresentation')+'\nreturn MavericksResurrectionProgressPresentation;')();
        var view=Function('MavericksResurrectionProgressPresentation',read('MacProgressView')+'\nreturn MavericksResurrectionMacProgressView;')(format).create(712,330);
        var window=$.NSWindow.alloc.mrInitWithXYWidthHeightStyleMaskBackingDefer(0,0,760,408,$.NSTitledWindowMask,$.NSBackingStoreBuffered,false);
        window.title=$('MavericksResurrection');window.releasedWhenClosed=false;view.view.mrSetFrameOriginWithXY(24,58);window.contentView.addSubview(view.view);
        var button=$.NSButton.alloc.mrInitWithXYWidthHeight(627,14,109,32);button.title=$('Cancel');button.bezelStyle=$.NSRoundedBezelStyle;
        state.delegate=$.MavericksSourceProgressDelegate.alloc.init;button.target=state.delegate;button.action='cancelSource:';window.contentView.addSubview(button);
        state.presentation={begin:view.begin,event:view.event,finish:view.finish,stopping:function(message){button.enabled=false;view.stopping(message);}};
        window.center;window.makeKeyAndOrderFront(null);return window;
    }
    function dispatchEvents() {
        var app = $.NSApplication.sharedApplication;
        var event = app.nextEventMatchingMaskUntilDateInModeDequeue($.NSAnyEventMask,
            $.NSDate.dateWithTimeIntervalSinceNow(0.1), $.NSDefaultRunLoopMode, true);
        if (event && !event.isNil()) app.sendEvent(event);
        app.updateWindows;
    }
    function execute(resources, request, logger, administratorLauncher) {
        if (active) throw new Error('An image preparation operation is already running.');
        var fm = $.NSFileManager.defaultManager, root = createIPC(), task, window, reader, outputHandle, errorHandle, authorizationErrorHandle;
        var stdoutPath = root + '/events', stderrPath = root + '/errors';
        var deploying=['deploy-prepared-system','install-from-image'].indexOf(request.action)>=0;
        var maintaining=['list-installations','inspect-installation','switch-nvme','recover-nvme','collect-diagnostics','list-repair-installations','inspect-repair','repair-updates','recover-repair'].indexOf(request.action)>=0;
        var authorizationErrors=root+'/authorization-errors',prefix=maintaining?'maintenance':deploying?'deployment':administratorLauncher?'stage':'source';
        active = {root: root, cancelPath: root + '/cancel', cancelled: false,cleaning:request.action==='delete-used-image',collecting:request.action==='collect-diagnostics'||request.action==='advanced-readonly',advanced:request.action.indexOf('advanced-')===0,maintaining:maintaining,preparingSystem:!!administratorLauncher&&!maintaining,deploying:deploying};
        var state = active, result, failure = '', pending = $.NSMutableData.data, lineBuffer = '', sawResult = false;
        function eventReceived(event) {
            if (!event || typeof event.type !== 'string') throw new Error('Malformed source-worker event.');
            if (logger) logger.record(prefix+'.worker', event);
            if(!state.cancelled||event.type!=='progress')state.presentation.event(event);
            if (event.type === 'progress') {
                // The shared view renders only measured percentages.
            } else if (event.type === 'result') {
                if (sawResult) throw new Error('Source worker returned more than one result.');
                sawResult = true; result = event.result;
            } else if (event.type === 'error') failure = String(event.message);
            else if (event.type === 'diagnostic') return;
            else throw new Error('Unknown source-worker event.');
        }
        function poll() {
            pending.appendData(reader.readDataToEndOfFile);
            if (!Number(pending.length)) return;
            // A partial UTF-8 code point can straddle two reads; keep its bytes.
            var decoded = $.NSString.alloc.initWithDataEncoding(pending, $.NSUTF8StringEncoding);
            if (!decoded || decoded.isNil()) return;
            lineBuffer += ObjC.unwrap(decoded); pending = $.NSMutableData.data;
            var lines = lineBuffer.split('\n'); lineBuffer = lines.pop();
            lines.forEach(function (line) { if (line.length) eventReceived(JSON.parse(line)); });
        }
        try {
            if (logger) logger.record(prefix+'.started', request);
            [stdoutPath, stderrPath].concat(administratorLauncher?[authorizationErrors]:[]).forEach(function (path) {
                if (!fm.createFileAtPathContentsAttributes($(path), $.NSData.data, $({NSFilePosixPermissions: 384}))) throw new Error('Cannot create private worker state.');
            });
            task = $.NSTask.alloc.init;
            task.launchPath = $('/usr/bin/osascript');
            var command = {};
            Object.keys(request).forEach(function (key) { command[key] = request[key]; });
            command.cancelFile = state.cancelPath;
            task.arguments = $(['-l', 'JavaScript', resources + '/src/SourceWorker.js', resources, JSON.stringify(command)]);
            task.standardInput = $.NSFileHandle.fileHandleForReadingAtPath('/dev/null');
            outputHandle = $.NSFileHandle.fileHandleForWritingAtPath($(stdoutPath));
            errorHandle = $.NSFileHandle.fileHandleForWritingAtPath($(stderrPath));
            task.standardOutput = outputHandle;
            task.standardError = errorHandle;
            if(administratorLauncher){
                var launch=maintaining?administratorLauncher.maintenance(resources,command,stdoutPath,stderrPath):deploying?administratorLauncher.deploy(resources,command,stdoutPath,stderrPath):administratorLauncher.stage(resources,command,stdoutPath,stderrPath);
                task.launchPath=$(launch.executable);task.arguments=$(launch.arguments);
                // The elevated worker streams into the pre-created private files.
                // Keep authorization-tool errors separate from worker errors.
                task.standardOutput=$.NSFileHandle.fileHandleForWritingAtPath('/dev/null');
                authorizationErrorHandle=$.NSFileHandle.fileHandleForWritingAtPath($(authorizationErrors));task.standardError=authorizationErrorHandle;
            }
            reader = $.NSFileHandle.fileHandleForReadingAtPath($(stdoutPath));
            if(presenter)state.presentation=presenter;else window=windowFor(state,resources);
            state.presentation.begin(request,cancel);
            task.launch;
            while (Boolean(task.running)) {
                try { poll(); }
                catch (error) { failure = String(error); cancel(); }
                dispatchEvents();
            }
            task.waitUntilExit; poll();
            var finishedMaintenance=maintaining&&sawResult&&result.change&&['committed','recovered','nothing-to-recover'].indexOf(result.change.status)>=0;
            var finishedCleanup=state.cleaning&&sawResult&&result&&result.completed===true&&result.path===request.entry.path;
            if (state.cancelled&&!finishedMaintenance&&!finishedCleanup) throw new Error(failure || (state.advanced ? 'Advanced operation cancelled. Any collected reports and recovery data have been retained.' : state.cleaning ? 'DMG cleanup cancelled. Mavericks installation succeeded.' : state.collecting ? 'Diagnostic collection cancelled. Your Mavericks installation is unchanged.' : maintaining ? 'Maintenance cancelled. Reopen the app to check or recover any unfinished driver change.' : state.deploying ? 'Installation cancelled. The selected partition may be formatted or partly installed; a working installation has not been confirmed.' : 'Preparation cancelled. Existing images, downloads and prepared files remain in the chosen workspace.'));
            if (failure) throw new Error(failure);
            if (Number(task.terminationStatus) !== 0) {
                var diagnostic = $.NSString.stringWithContentsOfFileEncodingError($(stderrPath), $.NSUTF8StringEncoding, null);
                var detail=diagnostic && !diagnostic.isNil()?ObjC.unwrap(diagnostic):'';
                if(administratorLauncher){var auth=$.NSString.stringWithContentsOfFileEncodingError($(authorizationErrors),$.NSUTF8StringEncoding,null);if(auth && !auth.isNil())detail+='\n'+ObjC.unwrap(auth);}
                throw new Error(detail.trim() || 'The preparation worker failed.');
            }
            if (!sawResult || lineBuffer.length || Number(pending.length)) throw new Error('The source worker did not return a complete result.');
            if (logger) logger.record(prefix+'.completed', result);
            return result;
        } catch (error) {
            if (logger) logger.record(prefix+'.failed', {message: String(error)});
            throw error;
        } finally {
            // Do not leave a worker modifying its private image after closing the UI.
            if (task && Boolean(task.running)) {
                cancel();
                while (Boolean(task.running)) dispatchEvents();
                task.waitUntilExit;
            }
            if (reader) reader.closeFile;
            if (outputHandle) outputHandle.closeFile;
            if (errorHandle) errorHandle.closeFile;
            if (authorizationErrorHandle) authorizationErrorHandle.closeFile;
            if(state.presentation)state.presentation.finish(sawResult&&!failure&&(!state.cancelled||finishedCleanup));
            if (window) window.close;
            active = null;
            // Remove only known IPC files and an empty, uniquely created directory.
            var names = fm.contentsOfDirectoryAtPathError($(root), null);
            if (names && !names.isNil()) {
                var list = ObjC.deepUnwrap(names);
                if (list.every(function (name) { return ['events', 'errors', 'cancel','authorization-errors'].indexOf(name) >= 0; })) {
                    list.forEach(function (name) { fm.removeItemAtPathError($(root + '/' + name), null); });
                    var remaining = fm.contentsOfDirectoryAtPathError($(root), null);
                    if (remaining && Number(remaining.count) === 0) fm.removeItemAtPathError($(root), null);
                }
            }
        }
    }
    return {setPresentation:function(value){if(active)throw new Error('Cannot replace the active progress view.');presenter=value;},execute: function(resources,request,logger){return execute(resources,request,logger,null);},
        prepareSystem:function(resources,request,logger,administratorLauncher){
            if(!administratorLauncher || typeof administratorLauncher.stage!=='function')throw new Error('Administrator launcher is missing.');
            return execute(resources,request,logger,administratorLauncher);
        },
        deploySystem:function(resources,request,logger,administratorLauncher){
            if(!administratorLauncher || typeof administratorLauncher.deploy!=='function')throw new Error('Administrator deployment launcher is missing.');
            return execute(resources,request,logger,administratorLauncher);
        },
        maintainSystem:function(resources,request,logger,administratorLauncher){
            if(!administratorLauncher||typeof administratorLauncher.maintenance!=='function')throw new Error('Administrator maintenance launcher is missing.');
            return execute(resources,request,logger,administratorLauncher);
        }};
}());
