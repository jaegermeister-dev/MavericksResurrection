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
        function repairAudio(model){
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
        function graphicsStores(model){
            if(model!=='MacBookPro11,4')return null;
            return {
                legacy:load('MacGraphicsSnapshotIO','MavericksResurrectionMacGraphicsSnapshotIO').create(stage,guard,io,resources,diagnostic),
                current:load('MacExperiments','MavericksResurrectionMacExperiments').create(stage,guard,io,resources,load,progress,cancelled,diagnostic)
            };
        }
        function pending(model){
            var normal=store.pending();
            if(model!=='MacBookPro11,4')return normal;
            var g=graphicsStores(model),old=g.legacy.pending(),current=g.current.pending();
            var found=[normal?{kind:'normal',record:normal}:null,old?{kind:'legacy-graphics',record:old}:null,current?{kind:'graphics',record:current}:null].filter(function(p){return !!p;});
            if(found.length>1)throw new Error('More than one unfinished repair was found. Collect diagnostics before continuing; no saved files were changed.');
            return found.length?found[0]:null;
        }
        function recover(model){
            if(model!=='MacBookPro11,4')return store.recover();
            var p=pending(model);if(!p)return {status:'nothing-to-recover'};
            if(p.kind==='normal')return store.recover();
            var g=graphicsStores(model);
            return p.kind==='legacy-graphics'?g.legacy.recover():g.current.recover();
        }
        function framebufferRepair(model){
            var g=graphicsStores(model);if(!g)return null;
            if(g.legacy.pending()||g.current.pending())throw new Error('Recover the unfinished graphics change using Fix post-update issues first.');
            if(g.legacy.state().selection==='native-112'){
                var a=g.legacy.assessment('original');
                return {legacy:true,assessment:{alreadySelected:false,components:a.components.concat(['System/Library/Extensions/AppleIntelFramebufferAzul.kext/Contents/MacOS/AppleIntelFramebufferAzul'])}};
            }
            // The standard 11,4 setup always includes the framebuffer alias.
            // Retire older optional AGPM/CPU selections through their verified
            // rollback snapshots; never guess or discard an altered original.
            return {engine:g.current,selection:'010',assessment:g.current.assessment('010')};
        }
        function assessment(model){
            if(model==='MacBookPro11,4'){
                var unfinished=pending(model);
                if(unfinished)return {model:model,pending:unfinished,alreadyRepaired:false,repairNeeded:true,components:[]};
            }
            var a=store.assessment(model),d=store.displayAssessment();
            if(!d.matches){a.components.push(d.path);a.alreadyRepaired=false;a.repairNeeded=true;}
            if(!a.pending){var f=framebufferRepair(model);if(f&&!f.assessment.alreadySelected){
                a.components=a.components.concat(f.assessment.components);a.alreadyRepaired=false;a.repairNeeded=true;
                a.framebufferRepairRequired=true;
            }}
            a.displayProfile=d;return a;
        }
        function run(model){
            // Use the existing experiment snapshot/cache transaction first; the
            // normal repair then leaves a final cache receipt for all components.
            // Each completed phase is durable and a retry can safely resume.
            guard.revalidate();if(pending(model))throw new Error('Recover the unfinished post-update repair first.');
            var f=framebufferRepair(model),framebuffer=null;
            if(f&&f.legacy){
                progress('Restoring the original graphics power profile…',null);
                var legacy=load('MacGraphicsExperiment','MavericksResurrectionMacGraphicsExperiment').create(stage,guard,io,resources,load,progress,cancelled,diagnostic);
                report('post-update.legacy-graphics.restored',legacy.run('original'));
                f=framebufferRepair(model);
            }
            if(f){progress('Checking Intel framebuffer compatibility…',null);framebuffer=f.engine.run(f.selection);report('post-update.framebuffer.verified',framebuffer);}
            var result;
            try{result=repairAudio(model);}catch(error){
                if(framebuffer&&framebuffer.status==='committed')throw new Error('Intel framebuffer compatibility was restored, but the remaining post-update repair failed: '+String(error));
                throw error;
            }
            if(framebuffer){result.framebuffer=framebuffer;if(framebuffer.status==='committed')result.status='committed';}
            stop();guard.revalidate();
            progress('Checking Retina display scaling…',null);
            var display=store.applyDisplayProfile();result.displayProfile=display;
            if(display.changed)result.status='committed';
            report('post-update.display-profile.verified',display);return result;
        }
        return {run:run,assessment:assessment,pending:pending,recover:recover};
    }
    return {create:create};
}());
