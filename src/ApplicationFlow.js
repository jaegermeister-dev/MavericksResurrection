/* Main-window workflow orchestration. Disk changes occur only in the confirmed
 * administrator deployment worker reached through installPrepared. */
var MavericksResurrectionApplicationFlow = (function () {
    'use strict';
    function supportedHost(version) {
        if (typeof version !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(version)) return false;
        var n=version.split('.').map(Number);
        return n[0]>=12;
    }
    function create(session, ui, initialFolder) {
        function cancelled(stage) { ui.status('Cancelled.');return {completed:false,cancelled:true,stage:stage}; }
        function hardware() {
            ui.status('Checking this Mac and its storage…');
            var inventory=session.inventory([]);
            if(!supportedHost(inventory.host.version))throw new Error('MavericksResurrection requires macOS Monterey 12 or later.');
            var decision=session.approveHardware(inventory);
            return {inventory:inventory,decision:decision};
        }
        function direct() {
            var h=hardware();if(!h.decision.accepted)return cancelled('hardware');
            ui.status('Preparing your selected installer source…');
            var frozen=session.source(initialFolder);if(!frozen)return cancelled('source');
            if(frozen.kind!=='verified-mavericks-inputs' || frozen.version!=='10.9.5' || frozen.build!=='13F34')throw new Error('The Mavericks installer source did not verify.');
            var paths=[frozen.image,frozen.workspace];
            ui.status('Confirm the Mac model for this installation.');
            var inventory=session.inventory(paths);
            var modelDecision=session.chooseInstallModel(inventory,h.decision);
            if(!modelDecision || !modelDecision.accepted)return cancelled('installation-model');
            ui.status('Choose an existing partition for Mavericks.');
            var selected=ui.choosePartition(inventory,'direct');
            if(!selected)return cancelled('partition');
            var choice=session.chooseInitialNVMe(inventory,selected);if(!choice.accepted)return cancelled('experimental-driver');
            ui.status('Check the selected partition in all three confirmation dialogs.');
            var installed=session.installImage(frozen,selected,paths,modelDecision,choice.candidate);
            if(!installed)return cancelled('format-confirmation');
            if(installed.kind!=='mavericks-direct-installation' || installed.verified!==true)throw new Error('The installation did not finish verification.');
            if(frozen.deleteAfterInstallation===true){
                ui.status('Installation verified. Deleting the installer DMG as requested…');
                try{installed.sourceCleanup=session.removeUsedImage(frozen,installed);}
                catch(e){installed.sourceCleanup={completed:false,path:frozen.image,message:String(e)};}
            }
            ui.status('Mavericks files installed and verified. Ready to start Mavericks.');
            ui.installed(selected,installed);
            return {completed:true,installation:installed,partition:selected};
        }
        function maintain(remove){
            ui.status('Checking this Mac before maintenance…');var inventory=session.inventory([]);
            if(!supportedHost(inventory.host.version))throw new Error('MavericksResurrection requires macOS Monterey 12 or later.');
            if(!session.approveMaintenanceHardware(inventory).accepted)return cancelled('hardware');
            ui.status('Looking for existing Mavericks installations…');var found=session.discoverMavericks();
            var selected=ui.chooseMavericks(found);if(!selected)return cancelled('installation');
            ui.status('Checking the current driver state…');var inspection=session.inspectMavericks(selected);
            if(inspection.pending){
                if(!ui.recoverNVMe(selected))return cancelled('recovery');
                ui.status('Restoring the preceding driver and cache state…');session.recoverMavericks(selected);
                inspection=session.inspectMavericks(selected);if(inspection.pending)throw new Error('Recovery is still required before another driver change.');
            }
            if(!inspection.state||typeof inspection.state.candidate!=='string')throw new Error('The active driver state is unavailable.');
            var current=inspection.state.candidate,key;
            if(remove){if(!session.confirmNVMeRemoval(selected,current))return cancelled('remove-driver');key='original';}
            else{key=session.chooseMaintenanceNVMe(selected,current);if(key===null)return cancelled('experimental-driver');}
            ui.status(remove?'Removing experimental NVMe support and rebuilding caches…':'Installing experimental NVMe support and rebuilding caches…');
            var changed=session.changeNVMe(selected,key);
            if(!changed.change||changed.change.status!=='committed'||changed.change.candidate!==key)throw new Error('The requested driver change did not finish verification.');
            ui.status('Driver state and caches verified. Ready to start Mavericks.');session.maintenanceComplete(selected,key);
            return {completed:true,partition:selected,maintenance:changed};
        }
        function repairUpdates(){
            ui.status('Confirm the Mac model for post-update repair.');var inventory=session.inventory([]);
            if(!supportedHost(inventory.host.version))throw new Error('MavericksResurrection requires macOS Monterey 12 or later.');
            var model=session.chooseRepairModel(inventory);if(!model)return cancelled('repair-model');
            ui.status('Looking for Mavericks on internal and external Mac OS Extended partitions…');
            var selected=ui.chooseMavericks(session.discoverRepairTargets());if(!selected)return cancelled('repair-installation');
            ui.status('Checking for overwritten compatibility patches…');var assessment=session.inspectRepair(selected,model);
            if(assessment.pending){if(!session.recoverRepairPrompt(selected))return cancelled('repair-recovery');session.recoverRepair(selected,model);assessment=session.inspectRepair(selected,model);}
            if(!assessment.alreadyRepaired&&!session.confirmRepair(selected,assessment))return cancelled('repair-confirmation');
            var result=assessment.alreadyRepaired?{repair:{status:'already-repaired'}}:session.repairUpdates(selected,model);
            session.repairComplete(selected,result);ui.status('Post-update compatibility repair verified.');return {completed:true,repair:result,partition:selected};
        }
        function collectDiagnostics(){
            ui.status('Choose where to save the diagnostic log.');
            if(!session.enableDiagnostics())return cancelled('diagnostic-folder');
            var inventory=session.inventory([]);
            if(!supportedHost(inventory.host.version))throw new Error('MavericksResurrection requires macOS Monterey 12 or later.');
            ui.status('Looking for existing Mavericks installations…');
            var selected=ui.chooseMavericks(session.discoverMavericks(),true);if(!selected)return cancelled('installation');
            ui.status('Collecting first-boot status and any previously enabled diagnostic output…');
            var result=session.collectInstallationDiagnostics(selected);
            if(!result||!result.collection||result.collection.complete!==true||result.collection.targetModified!==false||!result.export)throw new Error('Diagnostic collection did not complete.');
            ui.status(result.export.saved?'Installation diagnostics saved.':'Collection finished, but the diagnostic log could not be fully saved.');
            ui.diagnosticsCollected(selected,result);
            return {completed:result.export.saved,partition:selected,diagnostics:result};
        }
        return {direct:direct,repair:repairUpdates,nvme:function(){return maintain(false);},removeNVMe:function(){return maintain(true);},collectDiagnostics:collectDiagnostics};
    }
    return {create:create,supportedHost:supportedHost};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionApplicationFlow;
