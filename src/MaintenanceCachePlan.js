/* Existing-installation cache recipe. Keeps the current kernel/tool identities
 * and all previously cached non-NVMe bundles; it never substitutes stock files. */
var MavericksResurrectionMaintenanceCachePlan=(function(){
    'use strict';
    var nvme = typeof MavericksNVMePolicy !== 'undefined' ? MavericksNVMePolicy : require('./NVMePolicy');
    var nvmeIDs=['com.apple.iokit.IONVMeFamily','com.MinnowStor.NVMeGeneric','dev.Jaegermeister.MavericksNVMeCompatibility'];
    var slots=['/System/Library/Extensions/IONVMeFamily.kext','/System/Library/Extensions/NVMeGeneric.kext','/System/Library/Extensions/IONVMeFamily.kext/Contents/PlugIns/MavericksNVMeCompatibility.kext'];
    function hash(s){return typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);}
    function path(p){return typeof p==='string'&&/^\/(System\/Library|Library)\/Extensions\/.+\.kext$/.test(p)&&!/[\\\x00-\x1f\x7f]/.test(p)&&!p.split('/').slice(1).some(function(s){return !s||s==='.'||s==='..';});}
    function records(rows){
        if(!Array.isArray(rows)||!rows.length||rows.length>4096)throw new Error('The existing cache bundle inventory is missing or oversized.');
        var seen=Object.create(null),paths=Object.create(null);
        rows.forEach(function(r){if(!r||typeof r.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(r.id)||!path(r.path)||seen[r.id]||paths[r.path])throw new Error('The existing cache contains an unsafe or ambiguous bundle entry.');seen[r.id]=true;paths[r.path]=true;});
        ['com.apple.kpi.mach','com.apple.kpi.iokit','com.apple.iokit.IOStorageFamily','com.apple.iokit.IOPCIFamily'].forEach(function(id){if(!seen[id])throw new Error('The existing cache is missing a required storage/kernel interface.');});
    }
    function plan(target,currentRows,candidate){
        if(!target||target.version!=='10.9.5'||!/^13F[0-9]+$/.test(target.build)||!hash(target.kernelSHA256)||!hash(target.toolSHA256)||!hash(target.cacheSHA256)||target.architecture!=='x86_64')throw new Error('Current Mavericks kernel/tool/cache identities are required.');
        records(currentRows);
        var wanted=currentRows.filter(function(r){
            var known=nvmeIDs.indexOf(r.id),slot=slots.indexOf(r.path);
            if((known>=0||slot>=0)&&known!==slot)throw new Error('An unknown driver occupies a managed NVMe identity or path.');
            return known<0;
        }).map(function(r){return {id:r.id,path:r.path};});
        if(candidate!==null){
            if(!candidate||!candidate.payloadVerified||!candidate.reversible||!Array.isArray(candidate.drivers)||!candidate.drivers.length)throw new Error('A verified reversible candidate is required.');
            nvme.cacheRecords(candidate).forEach(function(d){var at=nvmeIDs.indexOf(d.id);if(at<0||d.path!==slots[at])throw new Error('Unexpected candidate cache identity.');wanted.push(d);});
        }
        records(wanted);
        return {kind:'mavericks-maintenance-cache-plan',version:target.version,build:target.build,architecture:target.architecture,
            kernelSHA256:target.kernelSHA256,toolSHA256:target.toolSHA256,previousCacheSHA256:target.cacheSHA256,
            selection:'existing-installation',records:wanted,candidate:candidate,exact:false,replaceKernel:false,replaceOtherDrivers:false};
    }
    return {plan:plan};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionMaintenanceCachePlan;
