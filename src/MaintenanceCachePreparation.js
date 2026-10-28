/* Rebuild from the selected installation's existing cache inventory and current
 * kernel/tool files, under an already durable driver-change transaction. */
var MavericksResurrectionMaintenanceCachePreparation=(function(){
    'use strict';
    var planning=typeof MavericksResurrectionMaintenanceCachePlan!=='undefined'?MavericksResurrectionMaintenanceCachePlan:require('./MaintenanceCachePlan');
    var cache=typeof MavericksResurrectionCachePreparation!=='undefined'?MavericksResurrectionCachePreparation:require('./CachePreparation');
    var root='System/Library/Caches/com.apple.kext.caches/Startup/';
    var information=[root+'IOKitPersonalities_x86_64.ioplist.gz',root+'KextPropertyValues_OSBundleHelper_x86_64.plist.gz'];
    function prepare(io,target,candidate){
        io.assertPrivateStage(); // The supplied IO also verifies its maintenance journal.
        io.verifyFile('mach_kernel',target.kernelSHA256);io.verifyFile('usr/sbin/kextcache',target.toolSHA256);io.verifyFile(root+'kernelcache',target.cacheSHA256);
        var work=io.begin();
        io.copy(work+'/previous-caches/Startup/kernelcache',work+'/inspection');
        io.runKextcache(['-prelinked-kernel','/'+work+'/inspection','-uncompressed']);
        var plan=planning.plan(target,io.prelinkRows(work+'/inspection'),candidate);
        plan.records.forEach(function(r){if(io.readBundle(r.path).CFBundleIdentifier!==r.id)throw new Error('A previously cached driver is missing or changed identity: '+r.path);});
        if(candidate)io.verifyCandidate(candidate);
        io.progress('Rebuilding information caches from this Mavericks installation.');
        io.runKextcache(['-system-caches','-arch','x86_64','-verbose','3']);information.forEach(io.verifyGzip);
        io.progress('Rebuilding the boot cache with the current Mavericks kernel.');
        io.runKextcache(cache.argumentsFor(plan,'/'+work+'/uncompressed'));
        var count=cache.verifyRows(io.prelinkRows(work+'/uncompressed'),plan,io.readBundle);
        io.copy(work+'/uncompressed',work+'/compressed');io.runKextcache(['-prelinked-kernel','/'+work+'/compressed','-compressed']);
        io.copy(work+'/compressed',work+'/roundtrip');io.runKextcache(['-prelinked-kernel','/'+work+'/roundtrip','-uncompressed']);
        if(io.sha256(work+'/uncompressed')!==io.sha256(work+'/roundtrip'))throw new Error('Maintained cache compression roundtrip differs.');
        io.preservePreviousAlert();io.publish(work+'/compressed',root+'kernelcache');
        io.verifyFile('mach_kernel',target.kernelSHA256);io.verifyFile('usr/sbin/kextcache',target.toolSHA256);io.assertPrivateStage();
        var receipt={kind:'mavericks-maintenance-caches',completed:true,version:target.version,build:target.build,kernelSHA256:target.kernelSHA256,toolSHA256:target.toolSHA256,
            previousCacheSHA256:target.cacheSHA256,candidate:candidate?candidate.id:null,bundleCount:count,kernelcacheSHA256:io.sha256(root+'kernelcache'),uncompressedSHA256:io.sha256(work+'/uncompressed'),informationCaches:{}};
        information.forEach(function(file){receipt.informationCaches[file]=io.sha256(file);});io.complete(work,receipt);return receipt;
    }
    return {prepare:prepare};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionMaintenanceCachePreparation;
