/* Existing-install driver changes. Caller owns an identity-bound offline mount
 * and verified payload staging. No target selection, mounting or formatting here.
 * The mount guard supplied here MUST remain usable after cancellation so that
 * rollback can always run. The supplied inspection IO must also ignore forward
 * cancellation. Only the forward cache work observes cancellation. */
var MavericksResurrectionMacNVMeMaintenance=(function(){
    'use strict';ObjC.import('Foundation');
    function create(stage,guard,io,resources,payload,modules,progress,cancelled,diagnostic){
        var store=modules.snapshot.create(stage,guard,io,resources,diagnostic),base=store.location()+'/';
        function report(e,d){try{if(diagnostic)diagnostic(e,d);}catch(_){} }
        function ordered(v){if(Array.isArray(v))return v.map(ordered);if(v&&typeof v==='object'){var r={};Object.keys(v).sort().forEach(function(k){r[k]=ordered(v[k]);});return r;}return v;}
        function hash(relative){guard(stage);return io.sha256(stage.root+'/'+relative);}
        function run(candidate){
            guard.revalidate();if(store.pending())throw new Error('Recover the unfinished NVMe change before choosing another driver.');
            if(cancelled&&cancelled())throw new Error('Driver change cancelled before any modification.');
            var baseline=store.baseline(),previous=store.state(),root=stage.root;
            var plist=$.NSDictionary.dictionaryWithContentsOfFile($(root+'/System/Library/CoreServices/SystemVersion.plist'));
            if(!plist||plist.isNil())throw new Error('Cannot read this Mavericks installation.');var version=ObjC.deepUnwrap(plist);
            var target={version:version.ProductVersion,build:version.ProductBuildVersion,architecture:'x86_64',
                kernelSHA256:hash('mach_kernel'),toolSHA256:hash('usr/sbin/kextcache'),cacheSHA256:hash('System/Library/Caches/com.apple.kext.caches/Startup/kernelcache')};
            var key=candidate?candidate.id:'original',snapshot=store.capture(),pending=store.begin(snapshot.id,key),receipt=null;
            function assertJournal(){
                guard(stage);var path=root+'/'+base+'pending.json',stat=io.stat(path);
                if(stat.kind!=='file'||stat.uid!==0||(stat.mode&18)!==0)throw new Error('The pending change is no longer protected.');
                var now=JSON.parse(io.readText(path));
                if(now.id!==pending.id||now.snapshot!==pending.snapshot||now.volumeUUID!==pending.volumeUUID||now.candidate!==key||JSON.stringify(ordered(now.owner))!==JSON.stringify(ordered(pending.owner)))throw new Error('The pending driver-change identity changed.');
            }
            try{
                report('nvme.change.started',{candidate:key,previous:previous.candidate,transaction:pending.id,baseline:baseline.id});
                store.apply(pending.id,candidate?payload:'-');
                var tool={path:'usr/sbin/kextcache',sha256:target.toolSHA256,bytes:io.stat(root+'/usr/sbin/kextcache').bytes};
                var runtime=modules.runtime.create(stage,guard,io.sha256,resources,diagnostic,cancelled,{kind:'journaled-maintenance',tool:tool,assertJournal:assertJournal});
                var executor=modules.executor.create(stage,guard,io.sha256,resources,tool,diagnostic);
                var cacheIO=modules.cacheIO.create(stage,guard,io.sha256,resources,modules.format,progress,cancelled,diagnostic,modules.information,runtime,{kind:'journaled-maintenance',assertJournal:assertJournal,executor:executor});
                receipt=modules.preparation.prepare(cacheIO,target,candidate);assertJournal();guard.revalidate();
                var result=store.commit(pending.id,receipt);report('nvme.change.committed',result);
                return {status:'committed',candidate:key,previous:previous.candidate,transaction:pending.id,baselineID:baseline.id,cache:receipt};
            }catch(failure){
                report('nvme.change.failed',{transaction:pending.id,error:String(failure)});
                try{
                    guard.revalidate();var current=store.pending();
                    if(!current){
                        // The helper may have committed durably and then lost its
                        // reply. Inspect that exact transaction instead of claiming
                        // rollback or repeating a successful operation.
                        var active=JSON.parse(io.readText(root+'/'+base+'active-state.json')),state=store.state();
                        if(active.transaction===pending.id&&state.candidate===key&&receipt&&JSON.stringify(ordered(active.cacheReceipt))===JSON.stringify(ordered(receipt))){
                            report('nvme.change.commit-reply-recovered',{transaction:pending.id});
                            return {status:'committed',candidate:key,previous:previous.candidate,transaction:pending.id,baselineID:baseline.id,cache:receipt};
                        }
                        throw new Error('No matching completed change or recoverable journal was found.');
                    }
                    if(current.id!==pending.id)throw new Error('Another change replaced this transaction.');
                    var restored=store.recover();
                    if(restored.status!=='recovered'||store.pending()!==null||store.state().candidate!==previous.candidate)throw new Error('Previous candidate was not restored.');
                    report('nvme.change.rolled-back',{transaction:pending.id,candidate:previous.candidate});
                }catch(recoveryFailure){var unfinished=new Error('The driver change failed and recovery is unfinished. Reopen MavericksResurrection with this volume connected to recover it.');unfinished.recoveryRequired=true;unfinished.operationFailure=String(failure);unfinished.recoveryFailure=String(recoveryFailure);throw unfinished;}
                var error=new Error('The driver change failed. The previous drivers and caches were restored. '+String(failure));error.restored=true;throw error;
            }
        }
        return {run:run,pending:store.pending,state:store.state,recover:function(){guard.revalidate();var r=store.recover();if(store.pending()!==null)throw new Error('Recovery remains unfinished.');return {status:r.status,candidate:store.state().candidate};}};
    }
    return {create:create};
}());
