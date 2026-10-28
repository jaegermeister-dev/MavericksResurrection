/* Administrator direct-from-DMG installer. No temporary installed OS image. */
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
        if (request.action!=='install-from-image' || request.workflow!=='direct' || request.target || request.disk || request.destination || request.test || request.allowImage) throw new Error('This worker only installs onto one confirmed existing partition.');
        var sources = Function(read(resources + '/src/SourceImages.js') + '\nreturn MavericksSourceImages;')();
        var components = Function('MavericksSourceImages', read(resources + '/src/PackagePreparation.js') + '\nreturn MavericksPackagePreparation;')(sources);
        var stages = Function(read(resources + '/src/StagePackages.js') + '\nreturn MavericksStagePackages;')();
        var adapter = Function(read(resources + '/src/MacSourceIO.js') + '\nreturn MavericksMacSourceIO;')();
        if (request.cancelFile && (typeof request.cancelFile !== 'string' || request.cancelFile.charAt(0) !== '/' || /[\x00-\x1f]/.test(request.cancelFile))) throw new Error('Invalid cancellation path.');
        var io = adapter.create(function (phase, message, percent) { emit({type: 'progress', phase: phase, message: message, percent:typeof percent==='number'?percent:null}); }, resources + '/src',
            function () { return !!request.cancelFile && Boolean($.NSFileManager.defaultManager.fileExistsAtPath($(request.cancelFile))); }, '',
            function (event, detail) { emit({type: 'diagnostic', event: event, detail: detail}); });
        var afterPackages = null, finalVerification=null, destination=null;
        if (request.action === 'install-from-image') {
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
            if(!policy.creationHostApproved(hardware.model,request.hostApprovals,hardware.board,JSON.parse(read(resources+'/assets/Compatibility.json'))))throw new Error('Unsupported host approval is missing.');
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
                var fidelityAdapter = Function(read(resources+'/src/MacFidelityIO.js')+'\nreturn MavericksResurrectionMacFidelityIO;')();
                var fidelityIO = fidelityAdapter.create(stage, guard, io.sha256, resources,
                    function(message,percent){io.progress('native-metadata',message,percent);},
                    function(event,detail){emit({type:'diagnostic',event:event,detail:detail});});
                result.nativeMetadata = fidelityIO.metadata();
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
                result.sharedCaches = fidelityIO.sharedCaches(runtime);
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
                io.progress('verify-system','Verifying the Mavericks filesystem on the selected partition.');
                return finalizer.verifyDestination(finalAdapter.create(io,resources,bootPreparation,
                    function(event,detail){emit({type:'diagnostic',event:event,detail:detail});},destination),receipt,
                    {model:modelCatalog,nvme:nvmePayload,candidates:nvmeCatalog,cache:cacheCatalog,
                        firstBoot:firstBootCatalog,tools:JSON.parse(read(resources+'/assets/NativeTools.json')),
                        packages:JSON.parse(read(resources+'/assets/InstallPackages.json'))},patchPlan,firstBootPlan);
            };
        }
        function load(n,symbol,deps){deps=deps||{};return Function.apply(null,Object.keys(deps).concat([read(resources+'/src/'+n+'.js')+'\nreturn '+symbol+';'])).apply(null,Object.keys(deps).map(function(k){return deps[k];}));}
        if(!request.source || request.source.kind!=='verified-mavericks-inputs' || request.source.version!=='10.9.5' || request.source.build!=='13F34')throw new Error('An inspected MavericksResurrection installer is required.');
        if(!Array.isArray(request.protectedPaths)||!Array.isArray(request.protectedIDs))throw new Error('Protected volumes are required.');
        var input=request.source,library=load('MacImageLibrary','MavericksResurrectionMacImageLibrary').create(io);
        var libraryEntry=library.selected(input.library);if(libraryEntry.path!==input.image)throw new Error('The installer build record differs.');
        var job=io.createJob(request.workspace,'direct-install');
        var sourceManifest=JSON.parse(read(resources+'/assets/SourceInputs.json')),catalog=JSON.parse(read(resources+'/assets/InstallPackages.json'));
        io.ensureFree(job,components.scratchBytes(catalog,true));
        // Resolve and verify the selected NVMe bundle before direct.install can
        // format the destination. The install stage reuses this private copy.
        if(nvmeChoice!==null){
            io.progress('nvme-preflight','Preparing the selected experimental NVMe driver.',0);
            io.preflightNVMePayload(job,nvmePayload);
            io.progress('nvme-preflight','Experimental NVMe driver prepared.',100);
        }
        var current=io.stat(input.image);
        if(current.kind!=='file'||!input.imageIdentity||current.identity!==input.imageIdentity.identity||current.bytes!==input.imageIdentity.bytes||current.modified!==input.imageIdentity.modified)throw new Error('The installer image changed after selection.');
        var runtime=load('MacRuntime','MavericksMacRuntime',{MavericksPolicy:policy});
        var report=function(e,d){emit({type:'diagnostic',event:e,detail:d});};runtime.setDiagnostic(report);
        var app=load('AppPolicy','MavericksAppPolicy',{MavericksPolicy:policy});
        var oldDeployment=load('PartitionDeployment','MavericksResurrectionPartitionDeployment',{MavericksPolicy:policy,MavericksAppPolicy:app,MavericksResurrectionCopyPreparedSystem:{}});
        var direct=load('DirectInstallation','MavericksResurrectionDirectInstallation',{MavericksPolicy:policy,MavericksAppPolicy:app,MavericksResurrectionPartitionDeployment:oldDeployment});
        var targetIO=load('MacPartitionIO','MavericksResurrectionMacPartitionIO',{MavericksPolicy:policy}).create(io,runtime,resources,job,request.protectedPaths.concat([input.image,request.workspace]),request.protectedIDs,report,'direct');
        var result=sources.withMount(io,input.image,job,'installersource',false,function(root,mount){
            var verifiedFile=sources.checkFiles(io,root,sourceManifest.files,mount);io.assertReadOnlyImage(mount);
            if(JSON.stringify(current)!==JSON.stringify(io.stat(input.image)))throw new Error('Installer image changed during verification.');
            var mounted={kind:'mounted-mavericks-inputs',version:'10.9.5',build:'13F34',root:root,mount:mount,verifiedFile:verifiedFile};
            var proof={kind:'mavericks-verified-installer-source',verified:true,workflow:'direct',imageIdentity:current,
                manifestSHA256:io.sha256(resources+'/assets/SourceInputs.json'),requiredBytes:Math.max(16*1024*1024*1024,catalog.packages.reduce(function(n,p){return n+p.installedKiB*1024;},0)+3*1024*1024*1024)};
            return direct.install(targetIO,request,proof,function(target){
                destination=target;var stage=target.current(),unbind=io.bindFreshDestination(target);
                try{
                    var installed=components.withComponents(io,mounted,job,catalog,sourceManifest,function(component){
                        io.assertReadOnlyImage(mount);io.progress('install-package','Installing '+component.name+' onto '+request.volumeName+'.',0);io.installComponent(component,stage);
                    });
                    var version=io.inspectStagedVersion(stage);
                    if(version.ProductVersion!=='10.9.5'||version.ProductBuildVersion!=='13F34')throw new Error('Installed OS version differs.');
                    var setup=afterPackages(stage);setup.cleanup.physicalMutation=true;
                    var receipt=stages.installedReceipt(installed,setup,null,job);
                    var verified=finalVerification(receipt);io.writeStageReceipt(job,{verified:true,receipt:receipt,installation:verified});return verified;
                }finally{unbind();}
            });
        });
        try{io.cleanupInstallationScratch(job);}catch(e){io.progress('warning','Installation verified; some temporary files remain in '+job+': '+e);}
        result.job=job;
        emit({type: 'result', result: result});
    } catch (error) {
        emit({type: 'error', message: String(error)});
        throw error;
    }
}
