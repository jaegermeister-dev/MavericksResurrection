/* A verified read-only installer source is consumed directly on one freshly
 * formatted partition. No installed-system image or whole-disk operation. */
var MavericksResurrectionDirectInstallation=(function(){
    'use strict';
    var policy=typeof MavericksPolicy!=='undefined'?MavericksPolicy:require('./Policy.js');
    var app=typeof MavericksAppPolicy!=='undefined'?MavericksAppPolicy:require('./AppPolicy.js');
    var deployment=typeof MavericksResurrectionPartitionDeployment!=='undefined'?MavericksResurrectionPartitionDeployment:require('./PartitionDeployment.js');
    function plan(snapshot,request,source){
        if(!request || request.action!=='install-from-image' || request.workflow!=='direct' ||
            !source || source.kind!=='mavericks-verified-installer-source' || source.verified!==true ||
            source.workflow!=='direct' || !source.imageIdentity || !(source.requiredBytes>0))throw new Error('A verified installer source is required.');
        if(!snapshot || !snapshot.info || !snapshot.whole || policy.freeSpace(snapshot.info)===null ||
            snapshot.info.VolumeName!==request.volumeName)throw new Error('The selected partition changed.');
        if(policy.capacity(snapshot.info)<source.requiredBytes)throw new Error('The selected partition is too small for Mavericks.');
        return app.prepareFormat(snapshot.info,snapshot.whole,snapshot.protectedIDs,request.approval,source,'direct');
    }
    function install(io,request,source,consume){
        var began=false,failure,result;
        try{
            var before=io.snapshot(request),confirmed=plan(before,request,source);
            io.record({phase:'ready-to-format',plan:confirmed,source:source});
            began=true;io.formatSelected(confirmed,before);
            var after=io.snapshot(request);deployment.formatted(before,after,'direct');
            io.record({phase:'formatted',target:policy.identity(after.info),source:source});
            var target=io.openFormatted(after);target.assertEmpty();
            result=consume(target);
            if(!result || result.kind!=='mavericks-direct-installation' || result.verified!==true)throw new Error('Destination verification did not complete.');
            result.target=policy.identity(after.info);
            io.record({phase:'installed',target:result.target,result:result});
        }catch(e){failure=e;}
        try{io.close();}catch(e){failure=new Error((failure?String(failure)+'\n':'')+'Could not unmount the destination: '+e);}
        if(failure)throw new Error(String(failure)+(began?'\nThe selected partition may be formatted or incomplete. Installation has not been confirmed.':''));
        return result;
    }
    return {plan:plan,install:install};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionDirectInstallation;
