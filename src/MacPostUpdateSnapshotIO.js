/* Native snapshot/journal transport for the maintenance worker. The caller must
 * supply the live offline-volume guard from its mount/discovery lifecycle.
 * This adapter never formats, mounts or selects a target. Native driver changes
 * accept only compiled inventory entries under an owned durable transaction.
 */
var MavericksResurrectionMacPostUpdateSnapshotIO=(function(){
    'use strict';ObjC.import('Foundation');
    function create(stage,validate,io,resources,diagnostic) {
        if(!stage || stage.writable!==true || stage.enforceOwners!==true || typeof validate!=='function' || typeof validate.revalidate!=='function')throw new Error('An identity-bound writable offline volume is required.');
        validate.revalidate();validate(stage);
        var root=stage.root,identity=io.stat(root).identity,parts=identity.split(':');
        if(parts.length!==2 || !parts.every(function(p){return /^[0-9]+$/.test(p);}) || root==='/')throw new Error('Invalid offline volume root identity.');
        var helper=resources+'/BundledTools/PostUpdateSnapshotStore',catalog=JSON.parse(io.readText(resources+'/assets/NativeTools.json'));
        var asset=catalog && catalog.tools && catalog.tools.PostUpdateSnapshotStore;
        if(!asset || asset.minimumHost!=='10.10' || !/^[a-f0-9]{64}$/.test(asset.sha256) || typeof asset.bytes!=='number' || asset.bytes<=0)throw new Error('The snapshot helper catalog is unavailable.');
        function report(e,d){try{if(diagnostic)diagnostic(e,d);}catch(_){} }
        function guard(){
            validate(stage);
            if(stage.root!==root || !stage.writable || !stage.enforceOwners || io.stat(root).identity!==identity)throw new Error('The offline volume identity changed.');
            var s=io.stat(helper),canonical=ObjC.unwrap($(helper).stringByStandardizingPath.stringByResolvingSymlinksInPath);
            if(canonical!==helper || s.kind!=='file' || s.bytes!==asset.bytes || io.sha256(helper)!==asset.sha256)throw new Error('The native snapshot helper changed.');
        }
        function uuid(s){if(typeof s!=='string'||!/^[A-F0-9]{8}-(?:[A-F0-9]{4}-){3}[A-F0-9]{12}$/.test(s))throw new Error('Invalid snapshot identifier.');return s;}
        function command(action,tail){
            // Native snapshot reads already bind the filesystem UUID and root.
            // Refresh disk information at mutation boundaries, not twice per read.
            if(['capture','begin','apply','recover','commit','display-apply'].indexOf(action)>=0)validate.revalidate();
            guard();var task=$.NSTask.alloc.init,out=$.NSPipe.pipe,errors=$.NSPipe.pipe;
            task.launchPath=$(helper);task.arguments=$([root,parts[0],parts[1],action].concat(tail||[]));
            task.environment=$({PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/root',LANG:'C',LC_ALL:'C'});
            task.standardInput=$.NSFileHandle.fileHandleForReadingAtPath('/dev/null');task.standardOutput=out;task.standardError=errors;
            report('repair.snapshot.started',{action:action,root:root,arguments:tail||[]});task.launch;
            // This helper emits one small JSON result or one bounded error, never
            // a file manifest/progress stream, so separate pipes cannot fill.
            var data=out.fileHandleForReading.readDataToEndOfFile,error=errors.fileHandleForReading.readDataToEndOfFile;task.waitUntilExit;
            var status=Number(task.terminationStatus),message=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(error,$.NSUTF8StringEncoding));
            report('repair.snapshot.finished',{action:action,status:status,error:message});guard();
            if(status)throw new Error('post-update repair '+action+' failed: '+message);
            var text=$.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding);if(!text||text.isNil()||Number(data.length)>65536)throw new Error('Invalid snapshot helper result.');
            return JSON.parse(ObjC.unwrap(text));
        }
        return {
            location:function(){var r=command('location');if(typeof r.relative!=='string'||!/^Library\/Application Support\/[^/]+\/PostUpdateRepair$/.test(r.relative)||r.relative.split('/').some(function(x){return x==='.'||x==='..';}))throw new Error('Invalid maintenance store location.');return r.relative;},
            capture:function(){var r=command('capture');if(r.verified!==true)throw new Error('Snapshot capture was not verified.');uuid(r.id);return r;},
            verify:function(id){var r=command('verify',[uuid(id)]);if(r.verified!==true||r.id!==id)throw new Error('Snapshot readback differs.');return r;},
            pending:function(){var r=command('pending');if(!Object.prototype.hasOwnProperty.call(r,'pending'))throw new Error('Missing pending-state result.');return r.pending;},
            begin:function(id,candidate){
                if(['MacBookPro11,4','MacBookPro11,5'].indexOf(candidate)<0)throw new Error('Unknown post-update repair candidate.');
                var r=command('begin',[uuid(id),candidate]);if(r.snapshot!==id||r.candidate!==candidate||r.phase!=='pending')throw new Error('The pending record differs.');uuid(r.id);return r;
            },
            recover:function(){var r=command('recover');if(['nothing-to-recover','recovered'].indexOf(r.status)<0)throw new Error('Recovery was not verified.');return r;},
            assessment:function(model){
                if(['MacBookPro11,4','MacBookPro11,5'].indexOf(model)<0)throw new Error('Unsupported repair model.');
                var r=command('assessment',[model]);if(r.model!==model||!Array.isArray(r.changedIndices)||!Array.isArray(r.components)||typeof r.repairNeeded!=='boolean')throw new Error('Repair assessment was incomplete.');return r;
            },
            displayAssessment:function(){return command('display-assessment');},
            applyDisplayProfile:function(){var r=command('display-apply');if(r.verified!==true)throw new Error('Display profile repair was not verified.');return r;},
            state:function(){return command('state');},
            apply:function(id,payload){
                if(typeof payload!=='string'||(payload!=='-'&&payload.charAt(0)!=='/'))throw new Error('Invalid verified payload location.');
                var r=command('apply',[uuid(id),payload]);if(r.applied!==true||r.transaction!==id)throw new Error('Driver application was not verified.');return r;
            },
            commit:function(id,receipt){
                var json=JSON.stringify(receipt);if(json.length>32768)throw new Error('Cache receipt is too large.');
                var r=command('commit',[uuid(id),json]);if(r.status!=='committed'||r.transaction!==id)throw new Error('Driver change was not committed.');return r;
            }
        };
    }
    return {create:create};
}());
