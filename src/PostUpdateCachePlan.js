/* Existing-installation cache recipe. Keeps the current kernel/tool identities
 * and all previously cached bundles, including NVMe; it never substitutes stock files. */
var MavericksResurrectionPostUpdateCachePlan=(function(){
    'use strict';
    function hash(s){return typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);}
    function path(p){return typeof p==='string'&&/^\/(System\/Library|Library)\/Extensions\/.+\.kext$/.test(p)&&!/[\\\x00-\x1f\x7f]/.test(p)&&!p.split('/').slice(1).some(function(s){return !s||s==='.'||s==='..';});}
    function records(rows){
        if(!Array.isArray(rows)||!rows.length||rows.length>4096)throw new Error('The existing cache bundle inventory is missing or oversized.');
        var seen=Object.create(null),paths=Object.create(null);
        rows.forEach(function(r){if(!r||typeof r.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(r.id)||!path(r.path)||seen[r.id]||paths[r.path])throw new Error('The existing cache contains an unsafe or ambiguous bundle entry.');seen[r.id]=true;paths[r.path]=true;});
        ['com.apple.kpi.mach','com.apple.kpi.iokit','com.apple.iokit.IOStorageFamily','com.apple.iokit.IOPCIFamily'].forEach(function(id){if(!seen[id])throw new Error('The existing cache is missing a required storage/kernel interface.');});
    }
    function plan(target,currentRows,model,required){
        if(!target||target.version!=='10.9.5'||!/^13F[0-9]+$/.test(target.build)||!hash(target.kernelSHA256)||!hash(target.toolSHA256)||!hash(target.cacheSHA256)||target.architecture!=='x86_64')throw new Error('Current Mavericks kernel, tool and cache identities are required.');
        if(['MacBookPro11,4','MacBookPro11,5'].indexOf(model)<0)throw new Error('Unsupported repair model.');
        records(currentRows);records(required);
        var wanted=currentRows.map(function(r){return {id:r.id,path:r.path};});
        required.forEach(function(r){var same=wanted.filter(function(x){return x.id===r.id||x.path===r.path;});
            if(same.length && (same.length!==1||same[0].id!==r.id||same[0].path!==r.path))throw new Error('A compatibility driver has an unexpected cache identity.');
            if(!same.length)wanted.push({id:r.id,path:r.path});
        });
        records(wanted);
        return {kind:'mavericks-post-update-cache-plan',version:target.version,build:target.build,architecture:target.architecture,
            kernelSHA256:target.kernelSHA256,toolSHA256:target.toolSHA256,previousCacheSHA256:target.cacheSHA256,
            selection:'existing-installation',records:wanted,model:model,candidate:null,exact:false,replaceKernel:false};
    }
    return {plan:plan};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionPostUpdateCachePlan;
