/* Optional graphics experiment on an existing, explicitly selected 11,4 install. */
ObjC.import('Foundation');
function run(argv){
 function emit(e){$.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify(e)+'\n').dataUsingEncoding($.NSUTF8StringEncoding));}
 try{
  if(argv.length!==2||ObjC.unwrap($.NSUserName())!=='root')throw Error('Administrator authorization required.');
  var resources=argv[0],request=JSON.parse(argv[1]);
  if(resources.charAt(0)!=='/'||/[\x00-\x1f]/.test(resources)||ObjC.unwrap($(resources).stringByStandardizingPath.stringByResolvingSymlinksInPath)!==resources)throw Error('Invalid resources path.');
  if(['advanced-graphics-inspect','advanced-graphics-apply','advanced-graphics-recover'].indexOf(request.action)<0||request.model!=='MacBookPro11,4'||request.confirmed!==true)throw Error('Confirm a MacBookPro11,4 installation first.');
  if(Object.keys(request).some(function(k){return ['action','target','model','confirmed','selection','workspace','protectedPaths','protectedIDs','cancelFile'].indexOf(k)<0;}))throw Error('Unexpected graphics request.');
  if(!/^[01]{3}$/.test(request.selection))throw Error('Invalid graphics selection.');
  function absolute(p){if(typeof p!=='string'||p.charAt(0)!=='/'||/[\x00-\x1f]/.test(p))throw Error('Invalid workspace path.');}
  absolute(request.workspace);absolute(request.cancelFile);if(!Array.isArray(request.protectedPaths)||!Array.isArray(request.protectedIDs))throw Error('Protected volumes are required.');request.protectedPaths.forEach(absolute);
  function load(n,s,deps){deps=deps||{};var code=$.NSString.stringWithContentsOfFileEncodingError($(resources+'/src/'+n+'.js'),$.NSUTF8StringEncoding,null);if(!code||code.isNil())throw Error('Missing graphics resource.');return Function.apply(null,Object.keys(deps).concat([ObjC.unwrap(code)+'\nreturn '+s+';'])).apply(null,Object.keys(deps).map(function(k){return deps[k];}));}
  var report=function(e,d){emit({type:'diagnostic',event:e,detail:d});};
  var policy=load('Policy','MavericksPolicy'),runtime=load('MacRuntime','MavericksMacRuntime',{MavericksPolicy:policy});runtime.setDiagnostic(report);
  if(!request.target||!policy.unchanged(request.target.identity,request.target.identity,false))throw Error('Select a listed Mavericks installation.');
  var io=load('MacSourceIO','MavericksMacSourceIO').create(function(p,m,n){emit({type:'progress',phase:p,message:m,percent:n});},resources+'/src',function(){return false;},'',report);
  var job=io.createJob(request.workspace,'graphics'),paths=request.protectedPaths.concat([request.cancelFile.slice(0,request.cancelFile.lastIndexOf('/'))]);
  var targets=load('PostUpdateTargets','MavericksResurrectionPostUpdateTargets',{MavericksPolicy:policy});
  var mounts=load('MacMaintenanceIO','MavericksResurrectionMacMaintenanceIO').create(io,runtime,resources,job,paths,request.protectedIDs,targets,policy,report);
  function cancelled(){return !!$.NSFileManager.defaultManager.fileExistsAtPath($(request.cancelFile));}
  if(cancelled())throw Error('Cancelled before opening the installation.');
  var opened=mounts.open(request.target),result;
  try{
   function progress(m,n){emit({type:'progress',phase:'experiments',message:m,percent:n});}
   var legacy=load('MacGraphicsSnapshotIO','MavericksResurrectionMacGraphicsSnapshotIO').create(opened.stage,opened.guard,io,resources,report);
   var legacyPending=legacy.pending(),legacyEnabled=legacy.state().selection==='native-112';
   if(legacyPending||legacyEnabled){
    if(request.action==='advanced-graphics-recover'){
     if(legacyPending)result={change:legacy.recover()};
     else result={change:load('MacGraphicsExperiment','MavericksResurrectionMacGraphicsExperiment').create(opened.stage,opened.guard,io,resources,load,progress,cancelled,report).run('original')};
    }else if(request.action==='advanced-graphics-inspect')result={pending:{legacy:true,enabled:legacyEnabled},assessment:null};
    else throw Error('Restore the previous Beta 5 graphics setting before applying a new experimental configuration.');
   }else{
    var experiment=load('MacExperiments','MavericksResurrectionMacExperiments').create(opened.stage,opened.guard,io,resources,load,progress,cancelled,report);
    var pending=experiment.pending();
    if(request.action==='advanced-graphics-inspect')result={pending:pending,assessment:pending?null:experiment.assessment(experiment.state().selection)};
    else if(request.action==='advanced-graphics-recover')result={change:experiment.recover()};
    else result={change:experiment.run(request.selection)};
   }
  }finally{opened.close();}
  result.identity=request.target.identity;emit({type:'result',result:result});
 }catch(e){emit({type:'error',message:String(e)});throw e;}
}
