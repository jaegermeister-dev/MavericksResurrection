/* Invoke with /usr/bin/osascript -l JavaScript SourceWorker.js <resources> <JSON>.
 * Each stdout line is one JSON event. Never run this source worker as root.
 * App resources layout: src/*.js, src/Download-MavericksForever.sh, assets/*.json.
 */
ObjC.import('Foundation');
function run(argv) {
    function emit(event) {
        $.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify(event) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
    }
    function read(path) {
        var error = Ref(), data = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, error);
        if (!data || data.isNil()) throw new Error('Cannot read app resource: ' + path);
        return ObjC.unwrap(data);
    }
    try {
        if (argv.length !== 2 || argv[0].charAt(0) !== '/' || /[\x00-\x1f]/.test(argv[0])) throw new Error('Invalid source-worker arguments.');
        if (ObjC.unwrap($.NSUserName()) === 'root') throw new Error('Source images must be prepared as the logged-in user.');
        var resources = ObjC.unwrap($(argv[0]).stringByStandardizingPath.stringByResolvingSymlinksInPath);
        var request = JSON.parse(argv[1]);
        // Only the app's own JavaScript is loaded. No selected DMG code is executed.
        var engine = Function(read(resources + '/src/SourceImages.js') + '\nreturn MavericksSourceImages;')();
        var adapter = Function(read(resources + '/src/MacSourceIO.js') + '\nreturn MavericksMacSourceIO;')();
        if (request.cancelFile && (typeof request.cancelFile !== 'string' || request.cancelFile.charAt(0) !== '/' || /[\x00-\x1f]/.test(request.cancelFile))) throw new Error('Invalid cancellation path.');
        var io = adapter.create(function (phase, message, percent) { emit({type: 'progress', phase: phase, message: message, percent: typeof percent==='number'?percent:null}); }, resources + '/src',
            function () { return !!request.cancelFile && Boolean($.NSFileManager.defaultManager.fileExistsAtPath($(request.cancelFile))); }, request.cancelFile || '',
            function (event, detail) { emit({type: 'diagnostic', event: event, detail: detail}); });
        var library=Function(read(resources+'/src/MacImageLibrary.js')+'\nreturn MavericksResurrectionMacImageLibrary;')().create(io);
        var manifest = JSON.parse(read(resources + '/assets/SourceInputs.json')), result;
        if (request.action === 'discover') {
            if (!Array.isArray(request.roots) || !request.roots.length) throw new Error('Select a folder to search.');
            result = library.discover(request.roots);
        } else if (request.action === 'inspect') {var chosen=library.selected(request.entry);if(chosen.path!==request.image)throw new Error('The selected image differs.');result=engine.inspect(io,request.image,request.workspace,manifest);}
        else if (request.action === 'freeze') result = engine.freeze(io, request.image, request.workspace, manifest);
        else if (request.action === 'build') {result=engine.build(io,request.workspace,manifest);result.library=library.register(result);}
        else if(request.action==='hash-built')result=library.hash(request.entry,true);
        else if(request.action==='check-image-hash')result=library.hash(request.entry,false);
        else if(request.action==='retire-image')result=library.retire(request.entry,request.disposition,request.actualHash);
        else if(request.action==='delete-used-image')result=library.removeUsed(request.entry);
        else throw new Error('Unknown source-image action.');
        emit({type: 'result', result: result});
    } catch (error) {
        emit({type: 'error', message: String(error)});
        throw error;
    }
}
