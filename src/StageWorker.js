/* Root-only private-image staging entry point; never accepts a disk destination.
 * Run through the app's administrator-authenticated worker launcher once integrated.
 * prepare-system produces a verified prepared image only after the final audit.
 * This worker performs no physical deployment and never claims a successful boot.
 */
ObjC.import('Foundation');
function run(argv) {
    function read(path) {
        var error = Ref(), text = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, error);
        if (!text || text.isNil()) throw new Error('Cannot read staging resource: ' + path);
        return ObjC.unwrap(text);
    }
    function emit(event) {
        $.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify(event) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
    }
    try {
        if (ObjC.unwrap($.NSUserName()) !== 'root') throw new Error('The stage worker needs administrator authentication.');
        if (argv.length !== 2 || argv[0].charAt(0) !== '/' || /[\x00-\x1f]/.test(argv[0])) throw new Error('Invalid staging arguments.');
        var resources = ObjC.unwrap($(argv[0]).stringByStandardizingPath.stringByResolvingSymlinksInPath);
        var request = JSON.parse(argv[1]);
        if (['stage-packages', 'prepare-system'].indexOf(request.action) < 0 || request.target || request.disk || request.destination) throw new Error('This worker only creates private images.');
        var sources = Function(read(resources + '/src/SourceImages.js') + '\nreturn MavericksSourceImages;')();
        var components = Function('MavericksSourceImages', read(resources + '/src/PackagePreparation.js') + '\nreturn MavericksPackagePreparation;')(sources);
        var stages = Function(read(resources + '/src/StagePackages.js') + '\nreturn MavericksStagePackages;')();
        var adapter = Function(read(resources + '/src/MacSourceIO.js') + '\nreturn MavericksMacSourceIO;')();
        if (request.cancelFile && (typeof request.cancelFile !== 'string' || request.cancelFile.charAt(0) !== '/' || /[\x00-\x1f]/.test(request.cancelFile))) throw new Error('Invalid cancellation path.');
        var io = adapter.create(function (phase, message, percent) { emit({type: 'progress', phase: phase, message: message, percent:typeof percent==='number'?percent:null}); }, resources + '/src',
            function () { return !!request.cancelFile && Boolean($.NSFileManager.defaultManager.fileExistsAtPath($(request.cancelFile))); }, '',
            function (event, detail) { emit({type: 'diagnostic', event: event, detail: detail}); });
        var afterPackages = null, finalVerification=null;
        if (request.action === 'prepare-system') {
            if (request.candidate !== undefined) throw new Error('Use the explicit nvmeCandidate choice for preparation.');
            if (request.nvmeCandidate !== undefined && request.nvmeCandidate !== null && typeof request.nvmeCandidate !== 'string') throw new Error('Invalid experimental NVMe choice.');
            var setup = Function(read(resources + '/src/OfflineSetup.js') + '\nreturn MavericksOfflineSetup;')();
            var setupAdapter = Function(read(resources + '/src/MacOfflineSetupIO.js') + '\nreturn MavericksMacOfflineSetupIO;')();
            var patchPlan = Function(read(resources + '/src/PatchPlan.js') + '\nreturn MavericksPatchPlan;')();
            var modelPatches = Function('MavericksPatchPlan', read(resources + '/src/ModelPatches.js') + '\nreturn MavericksModelPatches;')(patchPlan);
            var hardware = io.hardware();
            var policy=Function(read(resources+'/src/Policy.js')+'\nreturn MavericksPolicy;')();
            var installModel=Function('MavericksPolicy','MavericksPatchPlan',read(resources+'/src/InstallModel.js')+'\nreturn MavericksResurrectionInstallModel;')(policy,patchPlan);
            if(!request.host || request.host.model!==hardware.model || request.host.board!==hardware.board)throw new Error('The detected Mac differs from the confirmed host.');
            var selectedModel=installModel.confirmed(hardware,request.installationModel,request.modelApprovals,JSON.parse(read(resources+'/assets/Compatibility.json')));
            emit({type:'diagnostic',event:'preparation.installation-model',detail:{detected:hardware,selected:selectedModel}});
            var modelCatalog = JSON.parse(read(resources + '/assets/ModelPayload.json'));
            var nvmePolicy = Function(read(resources + '/src/NVMePolicy.js') + '\nreturn MavericksNVMePolicy;')();
            var nvmeStage = Function('MavericksNVMePolicy', 'MavericksModelPatches', read(resources + '/src/NVMeStage.js') + '\nreturn MavericksResurrectionNVMeStage;')(nvmePolicy, modelPatches);
            var nvmeCatalog = JSON.parse(read(resources + '/assets/NVMeCandidates.json'));
            var nvmePayload = JSON.parse(read(resources + '/assets/NVMePayload.json'));
            var nvmeChoice = request.nvmeCandidate === undefined ? null : request.nvmeCandidate;
            if (nvmeChoice !== null) { nvmePolicy.candidate(nvmeCatalog, nvmeChoice); nvmeStage.check(nvmeCatalog, nvmePayload); }
            var cacheCatalog = JSON.parse(read(resources + '/assets/CacheInputs.json'));
            var cacheFormat = Function(read(resources + '/src/CacheFormat.js') + '\nreturn MavericksResurrectionCacheFormat;')();
            var cacheInformation = Function(read(resources + '/src/MacCacheInformation.js') + '\nreturn MavericksResurrectionMacCacheInformation;')();
            var cachePreparation = Function('MavericksNVMePolicy', read(resources + '/src/CachePreparation.js') + '\nreturn MavericksResurrectionCachePreparation;')(nvmePolicy);
            var cacheAdapter = Function(read(resources + '/src/MacCacheIO.js') + '\nreturn MavericksResurrectionMacCacheIO;')();
            var runtimeAdapter = Function(read(resources + '/src/MacImageRuntime.js') + '\nreturn MavericksResurrectionMacImageRuntime;')();
            var bootPreparation = Function(read(resources + '/src/BootPreparation.js') + '\nreturn MavericksResurrectionBootPreparation;')();
            var bootAdapter = Function(read(resources + '/src/MacBootPreparationIO.js') + '\nreturn MavericksResurrectionMacBootPreparationIO;')();
            var cleanup = Function(read(resources + '/src/StageCleanup.js') + '\nreturn MavericksResurrectionStageCleanup;')();
            var cleanupAdapter = Function(read(resources + '/src/MacStageCleanupIO.js') + '\nreturn MavericksResurrectionMacStageCleanupIO;')();
            var manifests = Function(read(resources + '/src/TreeManifest.js') + '\nreturn MavericksResurrectionTreeManifest;')();
            var keychain = Function(read(resources + '/src/StockKeychainInitialization.js') + '\nreturn MavericksResurrectionStockKeychainInitialization;')();
            var keychainCatalog = JSON.parse(read(resources + '/assets/KeychainBootDependencies.json'));
            var firstBootPlan = Function(read(resources + '/src/FirstBootPlan.js') + '\nreturn MavericksResurrectionFirstBootPlan;')();
            var firstBootCatalog = JSON.parse(read(resources + '/assets/FirstBootInputs.json'));
            if (request.diagnosticsRequested !== undefined && typeof request.diagnosticsRequested !== 'boolean') throw new Error('Invalid first-boot diagnostics choice.');
            afterPackages = function (stage) {
                var guard = io.installedStageGuard(stage);
                var runtime = runtimeAdapter.create(stage, guard, io.sha256, resources,
                    function (event, detail) { emit({type: 'diagnostic', event: event, detail: detail}); },
                    function () { return !!request.cancelFile && Boolean($.NSFileManager.defaultManager.fileExistsAtPath($(request.cancelFile))); });
                var setupIO = setupAdapter.create(stage, guard,
                    function (message,percent) { io.progress('offline-setup', message,percent); },
                    function (event, detail) { emit({type: 'diagnostic', event: event, detail: detail}); },
                    {runtime: runtime, hash: io.sha256, keychain: keychain, keychainCatalog: keychainCatalog, firstBootPlan: firstBootPlan,
                        firstBootCatalog: firstBootCatalog, resources: resources, diagnosticsRequested: request.diagnosticsRequested === true});
                var result = setup.apply(setupIO);
                guard.revalidate();
                result.modelPatches = modelPatches.apply(io, stage, selectedModel.model, selectedModel.board, modelCatalog);
                result.modelPatches.installationModel = selectedModel;
                result.nvme = nvmeStage.apply(io, stage, nvmeChoice, nvmeCatalog, nvmePayload);
                result.caches = (function () {
                    var cacheIO = cacheAdapter.create(stage, guard, io.sha256, resources, cacheFormat,
                        function (message,percent) { io.progress('caches', message,percent); },
                        function () { return !!request.cancelFile && Boolean($.NSFileManager.defaultManager.fileExistsAtPath($(request.cancelFile))); },
                        function (event, detail) { emit({type: 'diagnostic', event: event, detail: detail}); }, cacheInformation, runtime);
                    return cachePreparation.prepare(cacheIO, result.modelPatches.profile, cacheCatalog, nvmeChoice, nvmeCatalog);
                }());
                result.boot = bootPreparation.prepare(bootAdapter.create(stage, guard, io.sha256,
                    function (event, detail) { emit({type: 'diagnostic', event: event, detail: detail}); }), result.modelPatches.profile);
                result.cleanup = cleanup.prepare(cleanupAdapter.create(stage, guard, io.sha256, resources, manifests,
                    function (event, detail) { emit({type: 'diagnostic', event: event, detail: detail}); }), result);
                guard.revalidate();
                return result;
            };
            var finalizer=Function(read(resources+'/src/FinalVerification.js')+'\nreturn MavericksResurrectionFinalVerification;')();
            var finalAdapter=Function(read(resources+'/src/MacFinalVerificationIO.js')+'\nreturn MavericksResurrectionMacFinalVerificationIO;')();
            finalVerification=function(receipt){
                io.progress('verify-system','Verifying the prepared Mavericks filesystem.');
                return finalizer.verify(finalAdapter.create(io,resources,bootPreparation,
                    function(event,detail){emit({type:'diagnostic',event:event,detail:detail});}),receipt,
                    {model:modelCatalog,nvme:nvmePayload,candidates:nvmeCatalog,cache:cacheCatalog,
                        firstBoot:firstBootCatalog,tools:JSON.parse(read(resources+'/assets/NativeTools.json')),
                        packages:JSON.parse(read(resources+'/assets/InstallPackages.json'))},patchPlan,firstBootPlan);
            };
        }
        var result = stages.prepare(io, request.frozen, request.workspace,
            JSON.parse(read(resources + '/assets/InstallPackages.json')),
            JSON.parse(read(resources + '/assets/SourceInputs.json')), components, afterPackages, finalVerification);
        emit({type: 'result', result: result});
    } catch (error) {
        emit({type: 'error', message: String(error)});
        throw error;
    }
}
