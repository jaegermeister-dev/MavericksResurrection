/* Repair overwritten model patches on an identity-bound offline installation.
 * All originals and caches are retained by the native transaction. */
var MavericksResurrectionMacPostUpdateRepair=(function(){
    'use strict';ObjC.import('Foundation');
    function create(stage,guard,io,resources,load,progress,cancelled,diagnostic){
        var snapshot=load('MacPostUpdateSnapshotIO','MavericksResurrectionMacPostUpdateSnapshotIO');
        var store=snapshot.create(stage,guard,io,resources,diagnostic),base=store.location()+'/';
        function report(e,d){try{if(diagnostic)diagnostic(e,d);}catch(_){} }
        function ordered(v){if(Array.isArray(v))return v.map(ordered);if(v&&typeof v==='object'){var r={};Object.keys(v).sort().forEach(function(k){r[k]=ordered(v[k]);});return r;}return v;}
        function hash(p){guard(stage);return io.sha256(stage.root+'/'+p);}
        function stop(){if(cancelled&&cancelled())throw new Error('Post-update repair cancelled.');}
        function run(model){
            if(['MacBookPro11,4','MacBookPro11,5'].indexOf(model)<0)throw new Error('No post-update compatibility patches are provided for this model.');
            guard.revalidate();if(store.pending())throw new Error('Recover the unfinished post-update repair first.');stop();
            var assessment=store.assessment(model);if(assessment.alreadyRepaired)return {status:'already-repaired',model:model,components:[]};
            progress('Preparing compatibility patches for '+model+'…',null);
            var catalog=JSON.parse(io.readText(resources+'/assets/ModelPayload.json')),cacheCatalog=JSON.parse(io.readText(resources+'/assets/CacheInputs.json'));
            var payload=io.preparePostUpdatePayload(stage.job,catalog);stop();
            var root=stage.root,plist=$.NSDictionary.dictionaryWithContentsOfFile($(root+'/System/Library/CoreServices/SystemVersion.plist'));
            if(!plist||plist.isNil())throw new Error('Cannot read this Mavericks installation.');var version=ObjC.deepUnwrap(plist);
            var target={version:version.ProductVersion,build:version.ProductBuildVersion,architecture:'x86_64',kernelSHA256:hash('mach_kernel'),toolSHA256:hash('usr/sbin/kextcache'),cacheSHA256:hash('System/Library/Caches/com.apple.kext.caches/Startup/kernelcache')};
            progress('Saving rollback copies of the current compatibility patches and caches…',null);
            var saved=store.capture();stop();var pending=store.begin(saved.id,model),receipt=null;
            function assertJournal(){
                guard(stage);var path=root+'/'+base+'pending.json',stat=io.stat(path);
                if(stat.kind!=='file'||stat.uid!==0||(stat.mode&18)!==0)throw new Error('The pending repair record is no longer protected.');
                var now=JSON.parse(io.readText(path));if(JSON.stringify(ordered(now))!==JSON.stringify(ordered(pending)))throw new Error('The pending repair identity changed.');
            }
            try{
                report('post-update.repair.started',{model:model,components:assessment.components,transaction:pending.id});stop();
                progress('Restoring overwritten compatibility patches…',null);store.apply(pending.id,payload);stop();
                var tool={path:'usr/sbin/kextcache',sha256:target.toolSHA256,bytes:io.stat(root+'/usr/sbin/kextcache').bytes};
                var runtime=load('MacImageRuntime','MavericksResurrectionMacImageRuntime').create(stage,guard,io.sha256,resources,diagnostic,cancelled,{kind:'journaled-maintenance',tool:tool,assertJournal:assertJournal});
                var executor=load('MacCacheToolExecutor','MavericksResurrectionMacCacheToolExecutor').create(stage,guard,io.sha256,resources,tool,diagnostic);
                var cacheIO=load('MacCacheIO','MavericksResurrectionMacCacheIO').create(stage,guard,io.sha256,resources,load('CacheFormat','MavericksResurrectionCacheFormat'),progress,cancelled,diagnostic,load('MacCacheInformation','MavericksResurrectionMacCacheInformation'),runtime,{kind:'journaled-maintenance',assertJournal:assertJournal,executor:executor});
                var preparation=load('PostUpdateCachePreparation','MavericksResurrectionPostUpdateCachePreparation',{MavericksResurrectionPostUpdateCachePlan:load('PostUpdateCachePlan','MavericksResurrectionPostUpdateCachePlan'),MavericksResurrectionCachePreparation:load('CachePreparation','MavericksResurrectionCachePreparation',{MavericksNVMePolicy:load('NVMePolicy','MavericksNVMePolicy')})});
                receipt=preparation.prepare(cacheIO,target,model,cacheCatalog.releasedRecords);assertJournal();guard.revalidate();stop();
                var result=store.commit(pending.id,receipt);report('post-update.repair.committed',result);
                return {status:'committed',model:model,components:assessment.components,snapshot:saved.id,transaction:pending.id,cache:receipt};
            }catch(failure){
                report('post-update.repair.failed',{transaction:pending.id,error:String(failure)});
                try{
                    guard.revalidate();var current=store.pending();
                    if(!current){var active=store.state();if(active.transaction===pending.id&&receipt&&JSON.stringify(ordered(active.cacheReceipt))===JSON.stringify(ordered(receipt)))return {status:'committed',model:model,components:assessment.components,snapshot:saved.id,transaction:pending.id,cache:receipt};throw new Error('No matching completed repair or recoverable journal was found.');}
                    if(current.id!==pending.id)throw new Error('Another operation replaced this repair.');
                    var restored=store.recover();if(restored.status!=='recovered'||store.pending()!==null)throw new Error('The previous state was not restored.');
                    report('post-update.repair.rolled-back',{transaction:pending.id});
                }catch(recoveryFailure){var e=new Error('Repair failed and recovery is unfinished. Reopen MavericksResurrection and select Fix post-update issues for this installation to recover it.');e.recoveryRequired=true;e.operationFailure=String(failure);e.recoveryFailure=String(recoveryFailure);throw e;}
                throw new Error('Repair failed. The previous patches and caches were restored. '+String(failure));
            }
        }
        return {run:run,assessment:store.assessment,pending:store.pending,recover:store.recover};
    }
    return {create:create};
}());
