/* Private engineering destination adapter; no physical disks or formatting. */
var MavericksResurrectionMacPrivateSystemCopyIO=(function(){
    'use strict';
    function create(io,stage,resources,bootPreparation,bootAdapter,diagnostic) {
        var current=stage,guard=io.installedStageGuard(stage),image=stage.image;
        var destination={
            current:function(){return current;},guard:function(){return guard;},
            assertEmpty:function(){io.assertInstalledStage(current);},
            readOnly:function(){var old=current;io.detach(current);current=null;current=io.attachVerificationImage(old.image,old.job);guard=io.verificationStageGuard(current);return current;},
            close:function(){if(current){io.detach(current);current=null;}},
            identity:function(){return {privateImage:image};}
        };
        return MavericksResurrectionMacSystemCopyIO.create(io,destination,resources,bootPreparation,bootAdapter,diagnostic);
    }
    return {create:create};
}());
