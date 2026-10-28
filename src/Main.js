/* Applet entry point. Resource loading is local to the application bundle. */
ObjC.import('Foundation');ObjC.import('AppKit');
function run(argv){
    var app=$.NSApplication.sharedApplication;app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
    function read(p){var s=$.NSString.stringWithContentsOfFileEncodingError($(p),$.NSUTF8StringEncoding,null);if(!s || s.isNil())throw new Error('A MavericksResurrection resource is missing: '+p);return ObjC.unwrap(s);}
    var resources=ObjC.unwrap($.NSBundle.mainBundle.resourcePath);
    function load(n,s,deps){deps=deps||{};return Function.apply(null,Object.keys(deps).concat([read(resources+'/src/'+n+'.js')+'\nreturn '+s+';'])).apply(null,Object.keys(deps).map(function(k){return deps[k];}));}
    try{
        if(argv && argv.length)throw new Error('Open MavericksResurrection normally without command-line installation arguments.');
        var m={},identity=JSON.parse(read(resources+'/assets/AppIdentity.json')),capabilities=JSON.parse(read(resources+'/assets/AppCapabilities.json'));
        if(identity.displayName!=='MavericksResurrection' || identity.minimumHostVersion!=='12.0')throw new Error('The application identity is invalid.');
        m.policy=load('Policy','MavericksPolicy');m.appPolicy=load('AppPolicy','MavericksAppPolicy',{MavericksPolicy:m.policy});
        m.partitionView=load('PartitionViewModel','MavericksPartitionViewModel',{MavericksPolicy:m.policy});
        m.nvmePolicy=load('NVMePolicy','MavericksNVMePolicy');m.nvmeCatalog=JSON.parse(read(resources+'/assets/NVMeCandidates.json'));
        m.patchPlan=load('PatchPlan','MavericksPatchPlan');m.compatibility=JSON.parse(read(resources+'/assets/Compatibility.json'));
        m.installModel=load('InstallModel','MavericksResurrectionInstallModel',{MavericksPolicy:m.policy,MavericksPatchPlan:m.patchPlan});
        m.dialogs=load('MacDialogs','MavericksMacDialogs',{MavericksPolicy:m.policy,MavericksAppPolicy:m.appPolicy,MavericksPartitionViewModel:m.partitionView,MavericksNVMePolicy:m.nvmePolicy});
        if(!m.dialogs.startup())return;
        if(Number(m.dialogs.alert('Before booting Mavericks', 'On MacBookPro11,5, having HDMI connected to the laptop during boot can cause a white screen or kernel panic. Disconnect it before starting Mavericks; connect it after reaching the desktop. Treat MacBookPro11,4 the same way until tested.\n\nDock HDMI worked during boot in testing, but results may vary between docks. If startup fails, disconnect HDMI or the dock until Mavericks has started.\n\nKeep this macOS install available for diagnostics, post-update repair and NVMe maintenance.', ['Continue','Quit']).runModal)!==1000)return;
        m.runtime=load('MacRuntime','MavericksMacRuntime',{MavericksPolicy:m.policy});
        m.sourceFlow=load('SourceAcquisition','MavericksResurrectionSourceAcquisition');
        m.sourceDialogs=load('MacSourceDialogs','MavericksMacSourceDialogs',{MavericksResurrectionSourceAcquisition:m.sourceFlow});m.runner=load('MacSourceRunner','MavericksMacSourceRunner');
        m.workerLaunch=load('WorkerLaunch','MavericksResurrectionWorkerLaunch');m.copySystem=load('CopyPreparedSystem','MavericksResurrectionCopyPreparedSystem');
        m.logs=load('DiagnosticLog','MavericksResurrectionDiagnosticLog');m.sessions=load('DiagnosticSession','MavericksResurrectionDiagnosticSession');
        m.nativeLog=load('MacDiagnosticLog','MavericksResurrectionMacDiagnosticLog');m.controls=load('MacDiagnosticControls','MavericksResurrectionMacDiagnosticControls');
        var session=load('MacApplicationSession','MavericksResurrectionMacApplicationSession').create(resources,700,m,function(message){m.dialogs.alert('Diagnostic logging stopped',message,['Continue']).runModal;});
        var presentation=load('ProgressPresentation','MavericksResurrectionProgressPresentation');
        var progress=load('MacProgressView','MavericksResurrectionMacProgressView',{MavericksResurrectionProgressPresentation:presentation}).create(766,324);
        var windowLayout=load('MainWindowLayout','MavericksResurrectionMainWindowLayout');
        var actions={},window=load('MacMainWindow','MavericksResurrectionMacMainWindow',{MavericksResurrectionMainWindowLayout:windowLayout}).create(resources,session,m.dialogs,capabilities,actions,progress,m.sourceDialogs);
        m.runner.setPresentation(window.presentation);
        var ui={status:window.status,choosePartition:m.dialogs.choosePartition,installed:window.installed,chooseMavericks:m.dialogs.chooseMavericks,recoverNVMe:m.dialogs.recoverNVMe,diagnosticsCollected:window.diagnosticsCollected};
        var flow=load('ApplicationFlow','MavericksResurrectionApplicationFlow').create(session,ui,ObjC.unwrap($.NSHomeDirectory()));
        actions.direct=flow.direct;
        actions.advanced=load('MacAdvancedTools','MavericksResurrectionMacAdvancedTools').create(resources,session,m,window).open;
        actions.nvme=flow.nvme;actions.removeNVMe=flow.removeNVMe;
        actions.collectDiagnostics=flow.collectDiagnostics;actions.repair=flow.repair;
        // Direct installation uses verified preparation and separately
        // confirmed deployment workers. Release packaging has its own readiness gate.
        window.run();
    }catch(error){
        var alert=$.NSClassFromString('MRCompletedAlert').alloc.init;alert.messageText=$('MavericksResurrection could not start');alert.informativeText=$(String(error));alert.addButtonWithTitle('Quit');alert.runModal;
    }
}
