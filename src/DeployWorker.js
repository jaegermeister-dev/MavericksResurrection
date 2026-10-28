/* Administrator worker for confirmed direct installation. The entry has
 * no disk-image test override, partition-map command or alternate executable. */
ObjC.import('Foundation');
function run(argv) {
    function read(p) { var s=$.NSString.stringWithContentsOfFileEncodingError($(p),$.NSUTF8StringEncoding,null);if(!s || s.isNil())throw new Error('Cannot read deployment resource.');return ObjC.unwrap(s); }
    function emit(e) { $.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify(e)+'\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
    function absolute(p) { if(typeof p!=='string' || p.charAt(0)!=='/' || /[\x00-\x1f\x7f]/.test(p))throw new Error('Invalid deployment path.');return p; }
    try {
        if(ObjC.unwrap($.NSUserName())!=='root' || argv.length!==2)throw new Error('Administrator authorization is required.');
        var resources=ObjC.unwrap($(absolute(argv[0])).stringByStandardizingPath.stringByResolvingSymlinksInPath),request=JSON.parse(argv[1]);
        if(!request || request.workflow!=='direct' || request.action!=='deploy-prepared-system' || request.disk || request.destination || request.test || request.allowImage)throw new Error('Invalid partition deployment request.');
        absolute(request.workspace);if(request.cancelFile)absolute(request.cancelFile);
        if(!Array.isArray(request.protectedPaths) || !Array.isArray(request.protectedIDs))throw new Error('Protected source and log volumes are required.');
        request.protectedPaths.forEach(absolute);
        request.protectedIDs.forEach(function(d){if(typeof d!=='string' || !/^disk[0-9]+(?:s[0-9]+)+$/.test(d))throw new Error('Invalid protected volume identity.');});
        function load(n,s,deps){deps=deps||{};return Function.apply(null,Object.keys(deps).concat([read(resources+'/src/'+n+'.js')+'\nreturn '+s+';'])).apply(null,Object.keys(deps).map(function(k){return deps[k];}));}
        var policy=load('Policy','MavericksPolicy'),app=load('AppPolicy','MavericksAppPolicy',{MavericksPolicy:policy});
        var copy=load('CopyPreparedSystem','MavericksResurrectionCopyPreparedSystem');copy.verifyPrepared(request.prepared);
        var report=function(e,d){emit({type:'diagnostic',event:e,detail:d});};
        var io=load('MacSourceIO','MavericksMacSourceIO').create(function(p,m,n){emit({type:'progress',phase:p,message:m,percent:typeof n==='number'?n:null});},resources+'/src',
            function(){return !!request.cancelFile && Boolean($.NSFileManager.defaultManager.fileExistsAtPath($(request.cancelFile)));},'',report);
        var hardware=io.hardware(),compatibility=JSON.parse(read(resources+'/assets/Compatibility.json'));
        if(!request.host || request.host.model!==hardware.model || request.host.board!==hardware.board)throw new Error('The detected Mac differs from the confirmed host.');
        var patches=load('PatchPlan','MavericksPatchPlan');
        var selectedModel=load('InstallModel','MavericksResurrectionInstallModel',{MavericksPolicy:policy,MavericksPatchPlan:patches}).confirmed(hardware,request.installationModel,request.modelApprovals,compatibility);
        if(request.prepared.profile!==selectedModel.profile)throw new Error('The prepared system does not match the selected installation model.');
        if(!policy.creationHostApproved(hardware.model,request.hostApprovals,hardware.board,compatibility))throw new Error('Acknowledge the creation-host warning and confirm a supported target model.');
        report('deployment.installation-model',{detected:hardware,selected:selectedModel});
        if(request.nvmeCandidate!==request.prepared.candidate)throw new Error('The prepared experimental driver differs from the selected choice.');
        if(request.nvmeCandidate!==null)load('NVMePolicy','MavericksNVMePolicy').candidate(JSON.parse(read(resources+'/assets/NVMeCandidates.json')),request.nvmeCandidate);
        var runtime=load('MacRuntime','MavericksMacRuntime',{MavericksPolicy:policy});runtime.setDiagnostic(report);
        var job=io.createJob(request.workspace,'deployment');io.ensureFree(job,1024*1024*1024);
        report('deployment.workspace',{job:job});
        var protectedPaths=request.protectedPaths.slice();if(request.cancelFile)protectedPaths.push(request.cancelFile.slice(0,request.cancelFile.lastIndexOf('/')));
        var destination=load('MacPartitionIO','MavericksResurrectionMacPartitionIO',{MavericksPolicy:policy}).create(io,runtime,resources,job,protectedPaths,request.protectedIDs,report,request.workflow);
        var deployment=load('PartitionDeployment','MavericksResurrectionPartitionDeployment',{MavericksPolicy:policy,MavericksAppPolicy:app,MavericksResurrectionCopyPreparedSystem:copy});
        var systemCopy=load('MacSystemCopyIO','MavericksResurrectionMacSystemCopyIO'),boot=load('BootPreparation','MavericksResurrectionBootPreparation'),bootIO=load('MacBootPreparationIO','MavericksResurrectionMacBootPreparationIO');
        var result=deployment.deploy(destination,request,request.prepared,function(target,prepared){
            return copy.copy(systemCopy.create(io,target,resources,boot,bootIO,report),prepared);
        });
        emit({type:'result',result:{kind:'mavericks-direct-installation',verified:true,job:job,copy:result,firstBootPending:true,bootTested:false}});
    }catch(error){emit({type:'error',message:String(error)});throw error;}
}
