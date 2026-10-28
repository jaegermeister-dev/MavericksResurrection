/* Administrator entry for existing Mavericks installations. It cannot format,
 * repartition, deploy an OS, select a raw path or enable a disk-image test mode. */
ObjC.import('Foundation');
function run(argv){
    function read(p){var s=$.NSString.stringWithContentsOfFileEncodingError($(p),$.NSUTF8StringEncoding,null);if(!s||s.isNil())throw new Error('Cannot read maintenance resource.');return ObjC.unwrap(s);}
    function emit(e){$.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify(e)+'\n').dataUsingEncoding($.NSUTF8StringEncoding));}
    function absolute(p){if(typeof p!=='string'||p.charAt(0)!=='/'||/[\x00-\x1f\x7f]/.test(p))throw new Error('Invalid maintenance path.');return p;}
    try{
        if(argv.length!==2||ObjC.unwrap($.NSUserName())!=='root')throw new Error('Administrator authorization is required.');
        var resources=ObjC.unwrap($(absolute(argv[0])).stringByStandardizingPath.stringByResolvingSymlinksInPath),request=JSON.parse(argv[1]);
        if(!request||['list-installations','inspect-installation','switch-nvme','recover-nvme','collect-diagnostics','list-repair-installations','inspect-repair','repair-updates','recover-repair'].indexOf(request.action)<0||request.disk||request.destination||request.test||request.allowImage||request.approval||request.format||request.partition||request.reinstall)throw new Error('Invalid existing-installation maintenance request.');
        absolute(request.workspace);if(request.cancelFile)absolute(request.cancelFile);
        if(!Array.isArray(request.protectedPaths)||!Array.isArray(request.protectedIDs))throw new Error('Protected app, workspace and diagnostic volumes are required.');
        request.protectedPaths.forEach(absolute);request.protectedIDs.forEach(function(id){if(typeof id!=='string'||!/^disk[0-9]+(?:s[0-9]+)+$/.test(id))throw new Error('Invalid protected volume identifier.');});
        function load(n,s,deps){deps=deps||{};return Function.apply(null,Object.keys(deps).concat([read(resources+'/src/'+n+'.js')+'\nreturn '+s+';'])).apply(null,Object.keys(deps).map(function(k){return deps[k];}));}
        var repairAction=['list-repair-installations','inspect-repair','repair-updates','recover-repair'].indexOf(request.action)>=0;
        var policy=load('Policy','MavericksPolicy'),targets=repairAction?load('PostUpdateTargets','MavericksResurrectionPostUpdateTargets',{MavericksPolicy:policy}):load('MaintenanceTargets','MavericksResurrectionMaintenanceTargets',{MavericksPolicy:policy});
        var runtime=load('MacRuntime','MavericksMacRuntime',{MavericksPolicy:policy}),report=function(e,d){emit({type:'diagnostic',event:e,detail:d});};runtime.setDiagnostic(report);
        function cancelled(){return !!request.cancelFile&&Boolean($.NSFileManager.defaultManager.fileExistsAtPath($(request.cancelFile)));}
        // Inspection and recovery are deliberately independent of forward cancel.
        var io=load('MacSourceIO','MavericksMacSourceIO').create(function(p,m,n){emit({type:'progress',phase:p,message:m,percent:typeof n==='number'?n:null});},resources+'/src',function(){return false;},'',report);
        var job=io.createJob(request.workspace,'maintenance'),protectedPaths=request.protectedPaths.slice();
        if(request.cancelFile)protectedPaths.push(request.cancelFile.slice(0,request.cancelFile.lastIndexOf('/')));
        report('maintenance.workspace',{job:job});
        var mounts=load('MacMaintenanceIO','MavericksResurrectionMacMaintenanceIO').create(io,runtime,resources,job,protectedPaths,request.protectedIDs,targets,policy,report);
        if(cancelled())throw new Error('Maintenance cancelled before opening an installation.');
        if(request.action==='list-installations'||request.action==='list-repair-installations'){
            emit({type:'progress',phase:'discover-installations',message:'Looking for existing Mavericks installations on internal and external partitions.'});
            var found=mounts.discover(runtime.inventory([resources,job].concat(protectedPaths),request.protectedIDs));
            emit({type:'result',result:{kind:'mavericks-maintenance-discovery',job:job,installations:found.installations,unavailable:found.unavailable}});return;
        }
        if(!request.target||!request.target.identity||!policy.unchanged(request.target.identity,request.target.identity,false))throw new Error('Select a listed Mavericks installation.');
        if(request.action==='collect-diagnostics'){
            emit({type:'progress',phase:'collect-diagnostics',message:'Collecting first-boot status and any diagnostic output previously enabled for this installation.'});
            var collected=mounts.readSelected(request.target,function(stage,guard){return load('MacInstallationDiagnostics','MavericksResurrectionMacInstallationDiagnostics').collect(stage,guard,io,report,cancelled);});
            emit({type:'result',result:{kind:'mavericks-installation-diagnostics',identity:request.target.identity,version:{productVersion:request.target.productVersion,productBuild:request.target.productBuild},collection:collected}});return;
        }
        if(repairAction&&['MacBookPro11,4','MacBookPro11,5'].indexOf(request.model)<0)throw new Error('Confirm a supported model before post-update repair.');
        var candidate=null,payload=null;
        if(request.action==='switch-nvme'){
            if(request.candidate!=='original')candidate=load('NVMePolicy','MavericksNVMePolicy').candidate(JSON.parse(read(resources+'/assets/NVMeCandidates.json')),request.candidate);
            if(candidate){
                var catalog=JSON.parse(read(resources+'/assets/NVMeCandidates.json')),inventory=JSON.parse(read(resources+'/assets/NVMePayload.json'));
                var model=load('ModelPatches','MavericksModelPatches',{MavericksPatchPlan:load('PatchPlan','MavericksPatchPlan')});
                load('NVMeStage','MavericksResurrectionNVMeStage',{MavericksNVMePolicy:load('NVMePolicy','MavericksNVMePolicy'),MavericksModelPatches:model}).check(catalog,inventory);
                payload=io.prepareMaintenanceNVMePayload(job,inventory);
            }
        }
        if(cancelled())throw new Error('Maintenance cancelled before opening an installation.');
        var opened=mounts.open(request.target),result;
        try{
            if(repairAction){
                var repair=load('MacPostUpdateRepair','MavericksResurrectionMacPostUpdateRepair').create(opened.stage,opened.guard,io,resources,load,
                    function(m,n){emit({type:'progress',phase:'repair-updates',message:m,percent:typeof n==='number'?n:null});},cancelled,report);
                if(request.action==='inspect-repair')result={kind:'mavericks-repair-inspection',identity:opened.identity,version:opened.version,assessment:repair.assessment(request.model)};
                else result={kind:'mavericks-post-update-repair',identity:opened.identity,version:opened.version,repair:request.action==='recover-repair'?repair.recover():repair.run(request.model)};
            }else{
            var snapshot=load('MacNVMeSnapshotIO','MavericksResurrectionMacNVMeSnapshotIO');
            if(request.action==='inspect-installation'){
                var store=snapshot.create(opened.stage,opened.guard,io,resources,report),pending=store.pending();
                result={kind:'mavericks-maintenance-inspection',identity:opened.identity,version:opened.version,pending:pending,state:pending?null:store.state()};
            }else{
                var modules={snapshot:snapshot,runtime:load('MacImageRuntime','MavericksResurrectionMacImageRuntime'),executor:load('MacCacheToolExecutor','MavericksResurrectionMacCacheToolExecutor'),
                    cacheIO:load('MacCacheIO','MavericksResurrectionMacCacheIO'),format:load('CacheFormat','MavericksResurrectionCacheFormat'),information:load('MacCacheInformation','MavericksResurrectionMacCacheInformation'),
                    preparation:load('MaintenanceCachePreparation','MavericksResurrectionMaintenanceCachePreparation',{MavericksResurrectionMaintenanceCachePlan:load('MaintenanceCachePlan','MavericksResurrectionMaintenanceCachePlan',{MavericksNVMePolicy:load('NVMePolicy','MavericksNVMePolicy')}),MavericksResurrectionCachePreparation:load('CachePreparation','MavericksResurrectionCachePreparation',{MavericksNVMePolicy:load('NVMePolicy','MavericksNVMePolicy')})})};
                var maintenance=load('MacNVMeMaintenance','MavericksResurrectionMacNVMeMaintenance').create(opened.stage,opened.guard,io,resources,payload,modules,
                    function(message){emit({type:'progress',phase:'maintain-nvme',message:message});},cancelled,report);
                result={kind:'mavericks-nvme-maintenance',identity:opened.identity,version:opened.version,change:request.action==='recover-nvme'?maintenance.recover():maintenance.run(candidate)};
            }
            }
        }finally{opened.close();}
        emit({type:'result',result:result});
    }catch(error){emit({type:'error',message:String(error)});throw error;}
}
