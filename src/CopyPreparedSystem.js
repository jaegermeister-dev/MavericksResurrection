/* Copy a sealed prepared Mavericks filesystem into a newly formatted target.
 * Formatting/confirmation belongs to the caller. This stage never partitions. */
var MavericksResurrectionCopyPreparedSystem=(function(){
    'use strict';
    function positive(n){return typeof n==='number' && isFinite(n) && Math.floor(n)===n && n>0 && n<=9007199254740991;}
    function verifyPrepared(p) {
        if(!p || p.kind!=='mavericks-prepared-image' || p.workflow!=='direct' || p.verified!==true ||
            !p.image || typeof p.image.path!=='string' || p.image.path.charAt(0)!=='/' ||
            !/^[a-f0-9]{64}$/.test(p.image.sha256) || !positive(p.image.bytes) ||
            typeof p.manifest!=='string' || p.manifest.charAt(0)!=='/' || !/^[a-f0-9]{64}$/.test(p.manifestSHA256) ||
            ['stock','MacBookPro11,4','MacBookPro11,5'].indexOf(p.profile)<0 ||
            (p.candidate!==null && typeof p.candidate!=='string') || !p.audit || !positive(p.audit.logicalFileBytes) || !positive(p.audit.entries) ||
            p.audit.manifestSHA256!==p.manifestSHA256 || p.audit.profile!==p.profile || p.audit.candidate!==p.candidate ||
            p.bootTested!==false || p.nativeInitializationConfirmed!==false)
            throw new Error('A sealed prepared Mavericks image is required.');
    }
    function copy(io,prepared) {
        verifyPrepared(prepared);var failure,result;
        try {
            io.openSource(prepared);
            io.assertEmptyDestination();
            var selection=io.selectFiles(prepared);
            if(!selection || selection.validated!==true || selection.manifestSHA256!==prepared.manifestSHA256 || selection.entries<=0)throw new Error('Verified copy selection differs.');
            io.copyFiles();
            var metadata=io.copyDirectoryMetadata();
            if(!metadata || metadata.completed!==true || metadata.directories<=0)throw new Error('Copied directory metadata did not verify.');
            var boot=io.prepareBoot(prepared.profile);
            if(!boot || boot.completed!==true || boot.profile!==prepared.profile || boot.startupDiskChanged!==false)throw new Error('Destination boot records did not verify.');
            var comparison=io.verifyCopiedTree();
            if(!comparison || comparison.matched!==true || comparison.sourceManifestSHA256!==prepared.manifestSHA256 ||
                comparison.entries!==selection.entries || comparison.logicalFileBytes!==selection.logicalFileBytes ||
                !/^[a-f0-9]{64}$/.test(comparison.copiedManifestSHA256))throw new Error('The copied Mavericks filesystem did not verify.');
            io.assertSourceUnchanged();
            result={kind:'mavericks-system-copy',verified:true,profile:prepared.profile,candidate:prepared.candidate,
                sourceImageSHA256:prepared.image.sha256,sourceManifestSHA256:prepared.manifestSHA256,
                copiedManifestSHA256:comparison.copiedManifestSHA256,entries:comparison.entries,logicalFileBytes:comparison.logicalFileBytes,
                boot:boot,firstBootPending:true,nativeInitializationConfirmed:false,bootTested:false};
        }catch(e){failure=e;}
        try{io.close();}catch(e){throw new Error((failure?String(failure)+'\n':'')+'The image copy needs cleanup: '+String(e));}
        if(failure)throw failure;
        io.record(result);return result;
    }
    return {verifyPrepared:verifyPrepared,copy:copy};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionCopyPreparedSystem;
