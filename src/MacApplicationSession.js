/* Wiring shared by the main window and its source/install/maintenance actions. */
var MavericksResurrectionMacApplicationSession = (function () {
    'use strict';
    function create(resources, width, modules, warn) {
        var row = modules.controls.create(width, function (changed) {
            return modules.sessions.create(modules.logs, modules.nativeLog.adapter(), modules.nativeLog.chooseFolder,
                warn, changed, modules.runtime.volumeForPath);
        });
        var session = row.session, broadcasters = [modules.runtime, modules.dialogs, modules.sourceDialogs];
        var maintenanceFolder=null;
        broadcasters.forEach(function (module) { module.setDiagnostic(session.record); });
        function workspace(){if(!maintenanceFolder)maintenanceFolder=modules.sourceDialogs.maintenanceWorkspace();return maintenanceFolder;}
        function maintenanceRequest(action,target,candidate,model){
            var request={action:action,workspace:workspace(),protectedPaths:[resources,workspace()],protectedIDs:session.protectedVolumeIDs()};
            if(target)request.target=target;if(candidate)request.candidate=candidate;if(model)request.model=model;
            return session.operation(action,{partition:target?target.identity:null,candidate:candidate||null},function(){
                var result=modules.runner.maintainSystem(resources,request,session,modules.workerLaunch);
                if(!result)throw new Error('Maintenance did not return a result.');
                if(target&&(!modules.policy.unchanged(target.identity,result.identity,false)||!result.version||result.version.productVersion!==target.productVersion||result.version.productBuild!==target.productBuild))throw new Error('Maintenance returned a different installation identity.');
                return result;
            });
        }
        var api = {
            diagnostics: row, logger: session,
            enableDiagnostics:function(){return session.state().enabled||session.setEnabled(true).enabled;},
            collectInstallationDiagnostics:function(target){
                if(!session.state().enabled)throw new Error('Choose a diagnostic folder before collecting installation diagnostics.');
                var result=maintenanceRequest('collect-diagnostics',target);
                if(result.kind!=='mavericks-installation-diagnostics'||!result.collection||result.collection.complete!==true||result.collection.targetModified!==false||!Array.isArray(result.collection.files))throw new Error('Diagnostic collection did not complete.');
                var state=session.state();result.export={saved:state.enabled,path:state.path};return result;
            },
            approveMaintenanceHardware:function(inventory){return modules.dialogs.approveModel(inventory.host,modules.compatibility,true);},
            discoverMavericks:function(){
                var result=maintenanceRequest('list-installations');
                if(result.kind!=='mavericks-maintenance-discovery'||!Array.isArray(result.installations)||!Array.isArray(result.unavailable))throw new Error('Mavericks discovery did not complete.');return result;
            },
            chooseRepairModel:function(inventory){
                var choice=modules.dialogs.chooseInstallModel(inventory.host,function(text){return modules.installModel.select(inventory.host,text,modules.compatibility);});
                if(!choice)return null;
                if(['MacBookPro11,4','MacBookPro11,5'].indexOf(choice.model)<0){modules.dialogs.alert('No compatibility repair for this model','These post-update patches are for MacBookPro11,4 and MacBookPro11,5. Macs that officially support Mavericks do not need these model-specific patches.',['OK']).runModal;return null;}
                if(choice.model==='MacBookPro11,4'&&Number(modules.dialogs.alert('MacBookPro11,4 is untested','This uses the existing MacBookPro11,4 patch selection. Hardware testing has been performed on MacBookPro11,5 only.',['Continue','Cancel']).runModal)!==1000)return null;
                return choice.model;
            },
            discoverRepairTargets:function(){return maintenanceRequest('list-repair-installations');},
            inspectRepair:function(target,model){var r=maintenanceRequest('inspect-repair',target,null,model);if(r.kind!=='mavericks-repair-inspection'||!r.assessment||r.assessment.model!==model)throw new Error('Repair assessment did not complete.');return r.assessment;},
            recoverRepair:function(target,model){var r=maintenanceRequest('recover-repair',target,null,model);if(!r.repair||['recovered','nothing-to-recover'].indexOf(r.repair.status)<0)throw new Error('Repair recovery remains unfinished.');return r;},
            repairUpdates:function(target,model){var r=maintenanceRequest('repair-updates',target,null,model);if(r.kind!=='mavericks-post-update-repair'||!r.repair||['committed','already-repaired'].indexOf(r.repair.status)<0)throw new Error('Post-update repair was not verified.');return r;},
            confirmRepair:function(target,assessment){return Number(modules.dialogs.alert('Fix post-update issues',target.name+' — '+target.device+'\n'+target.format+'\nCapacity: '+modules.policy.bytes(target.capacity)+'; free: '+modules.policy.bytes(target.free)+'\nModel: '+assessment.model+'\n\n'+(assessment.components.length?'Restore these overwritten compatibility patches:\n'+assessment.components.map(function(p){return p.split('/').pop();}).join('\n'):'The compatibility patches are present. Rebuild their boot caches.')+'\n\nThe current patches and caches will be backed up on this Mavericks volume before repair. The selected installation will not be formatted.',['Repair selected installation','Cancel']).runModal)===1000;},
            recoverRepairPrompt:function(target){return Number(modules.dialogs.alert('Recover unfinished repair','An unfinished post-update repair exists on '+target.name+'. Restore its saved patches and caches before continuing.',['Recover','Cancel']).runModal)===1000;},
            repairComplete:function(target,result){modules.dialogs.alert(result.repair.status==='already-repaired'?'Compatibility patches are already repaired':'Post-update repair complete',target.name+'\n\n'+(result.repair.status==='already-repaired'?'The patches and recorded caches still match the completed repair.':'The compatibility patches and rebuilt boot caches have been verified. Boot into this Mavericks installation and check its display scaling, speakers, microphone and HDMI audio. Keep this macOS install available for troubleshooting.'),['OK']).runModal;},
            inspectMavericks:function(target){var result=maintenanceRequest('inspect-installation',target);if(result.kind!=='mavericks-maintenance-inspection'||(!result.pending&&!result.state))throw new Error('The current driver state was not verified.');return result;},
            recoverMavericks:function(target){var result=maintenanceRequest('recover-nvme',target);if(result.kind!=='mavericks-nvme-maintenance'||!result.change||['recovered','nothing-to-recover'].indexOf(result.change.status)<0)throw new Error('The unfinished change was not recovered.');return result;},
            changeNVMe:function(target,key){
                if(key!=='original')modules.nvmePolicy.candidate(modules.nvmeCatalog,key);
                var result=maintenanceRequest('switch-nvme',target,key);
                if(result.kind!=='mavericks-nvme-maintenance'||!result.change||result.change.status!=='committed'||result.change.candidate!==key)throw new Error('The selected driver change was not verified.');return result;
            },
            chooseMaintenanceNVMe:function(target,current){
                var inventory=api.inventory([workspace()]),matches=inventory.partitions.filter(function(p){return modules.policy.unchanged(target.identity,modules.policy.identity(p.info),false);});
                if(matches.length!==1)throw new Error('The selected installation changed. Select it again.');
                var storage=modules.policy.detectInternalStorage(inventory.storageReport,inventory.internalDisks);
                if(modules.dialogs.experimentalOffer(storage,matches[0].whole)==='not-now')return null;
                return modules.dialogs.chooseExperimentalDriver(modules.nvmeCatalog,current,target,modules.nvmePolicy.recommend(modules.nvmeCatalog,inventory,storage));
            },
            confirmNVMeRemoval:function(target,current){return modules.dialogs.removeNVMe(target,modules.nvmeCatalog,current);},
            maintenanceComplete:function(target,key){modules.dialogs.maintained(target,modules.nvmeCatalog,key);},
            approveHardware:function(inventory){
                var decision=modules.dialogs.approveModel(inventory.host,modules.compatibility);
                if(!decision.accepted)return decision;
                var storage=modules.policy.detectInternalStorage(inventory.storageReport,inventory.internalDisks);
                if(!modules.dialogs.storageNotice(storage))return {accepted:false,profile:decision.profile};
                decision.compatibilityProfile=decision.profile;
                decision.host={model:inventory.host.model,board:inventory.host.board};decision.storage=storage;return decision;
            },
            chooseInstallModel:function(inventory,hardwareDecision){
                if(!hardwareDecision || !hardwareDecision.accepted || !hardwareDecision.host ||
                    inventory.host.model!==hardwareDecision.host.model || inventory.host.board!==hardwareDecision.host.board)throw new Error('The detected Mac changed. Start the installation again.');
                var selected=modules.dialogs.chooseInstallModel(inventory.host,function(text){return modules.installModel.select(inventory.host,text,modules.compatibility);});
                if(!selected)return null;
                var approval=selected.overridden?modules.dialogs.approveModel(selected,modules.compatibility):hardwareDecision;
                if(!approval.accepted)return null;
                modules.installModel.confirmed(inventory.host,selected,approval.approvals,modules.compatibility);
                session.record('installation.model-selected',{detected:hardwareDecision.host,selected:selected});
                return {accepted:true,host:hardwareDecision.host,approvals:hardwareDecision.approvals,
                    installationModel:selected,modelApprovals:approval.approvals,profile:selected.profile,storage:hardwareDecision.storage};
            },
            chooseInitialNVMe:function(inventory,partition){
                var storage=modules.policy.detectInternalStorage(inventory.storageReport,inventory.internalDisks);
                if(modules.dialogs.experimentalOffer(storage,partition.whole)==='not-now')return {accepted:true,candidate:null};
                var candidate=modules.dialogs.chooseExperimentalDriver(modules.nvmeCatalog,null,null,modules.nvmePolicy.recommend(modules.nvmeCatalog,inventory,storage));
                return {accepted:candidate!==null,candidate:candidate};
            },
            inventory: function (sourceAndWorkspacePaths) {
                // Do not revisit a failed/unplugged log path here. Its ID was
                // resolved on selection and retained independently of file I/O.
                var paths = [resources].concat(sourceAndWorkspacePaths || []);
                var inventory = modules.runtime.inventory(paths, session.protectedVolumeIDs());
                session.record('hardware.inventory', inventory); return inventory;
            },
            source: function (initialFolder) {
                return session.operation('prepare-installer-source', {}, function () {
                    return modules.sourceDialogs.acquire(function (request) {
                        return modules.runner.execute(resources, request, session);
                    }, initialFolder);
                });
            },
            removeUsedImage:function(source,installed){
                if(!source||source.deleteAfterInstallation!==true||!source.library||source.library.path!==source.image||
                    !installed||installed.kind!=='mavericks-direct-installation'||installed.verified!==true)throw new Error('DMG deletion requires the selected option and a verified installation.');
                return session.operation('delete-used-installer-image',{image:source.image},function(){
                    var result=modules.runner.execute(resources,{action:'delete-used-image',entry:source.library},session);
                    if(!result||result.completed!==true||result.path!==source.image)throw new Error('The DMG deletion could not be confirmed.');
                    return result;
                });
            },
            prepareSystem:function(frozen,nvmeCandidate,hardwareDecision){
                if(!frozen || frozen.kind!=='frozen-mavericks-inputs' || typeof frozen.job!=='string' || frozen.job.charAt(0)!=='/')throw new Error('Choose and verify a Mavericks installer source first.');
                if(nvmeCandidate!==null)modules.nvmePolicy.candidate(modules.nvmeCatalog,nvmeCandidate);
                if(!hardwareDecision || !hardwareDecision.accepted)throw new Error('Confirm the installation model first.');
                var selected=modules.installModel.confirmed(hardwareDecision.host,hardwareDecision.installationModel,hardwareDecision.modelApprovals,modules.compatibility);
                var workspace=frozen.job.slice(0,frozen.job.lastIndexOf('/'));
                return session.operation('prepare-mavericks-system',{workspace:workspace,candidate:nvmeCandidate},function(){
                    var result=modules.runner.prepareSystem(resources,{action:'prepare-system',workspace:workspace,frozen:frozen,
                        nvmeCandidate:nvmeCandidate,host:hardwareDecision.host,installationModel:selected,modelApprovals:hardwareDecision.modelApprovals,
                        diagnosticsRequested:session.state().enabled},session,modules.workerLaunch);
                    if(!result || !result.verified || !result.prepared || !result.prepared.verified)throw new Error('Mavericks preparation did not finish verification.');
                    if(result.prepared.profile!==selected.profile)throw new Error('The prepared system differs from the selected installation model.');
                    return result;
                });
            },
            installImage:function(source,selected,sourcePaths,hardwareDecision,candidate){
                var workflow='direct';
                if(workflow!=='direct')throw new Error('Unknown installation workflow.');
                if(!source||source.kind!=='verified-mavericks-inputs'||!source.imageIdentity||!source.library)throw new Error('A verified app-created installer is required.');
                if(!hardwareDecision || !hardwareDecision.accepted || !hardwareDecision.host)throw new Error('Confirm the Mac compatibility warnings for this prepared system first.');
                var selectedModel=modules.installModel.confirmed(hardwareDecision.host,hardwareDecision.installationModel,hardwareDecision.modelApprovals,modules.compatibility);
                var paths=(sourcePaths||[]).concat([source.image,source.workspace]);
                function fresh(identity){
                    var current=modules.runtime.inventory([resources].concat(paths),session.protectedVolumeIDs());
                    if(current.host.model!==hardwareDecision.host.model || current.host.board!==hardwareDecision.host.board)throw new Error('The Mac differs from the confirmed hardware.');
                    var matches=current.partitions.filter(function(p){return modules.policy.unchanged(identity,modules.policy.identity(p.info),false);});
                    if(matches.length!==1)throw new Error('The selected partition changed or is no longer available.');
                    var p=matches[0],reason=modules.policy.targetReason(p.info,p.whole,current.protectedIDs,workflow);
                    if(reason)throw new Error(reason);
                    return modules.partitionView.row(p.info,p.whole);
                }
                var approval=modules.dialogs.confirmFormatting(selected,fresh,workflow);if(!approval)return null;
                var finalRow=fresh(approval.target),inventory=modules.runtime.inventory([resources].concat(paths),session.protectedVolumeIDs());
                if(finalRow.name!==selected.name)throw new Error('The selected partition name changed. Select it again.');
                return session.operation('install-mavericks',{partition:approval.target},function(){
                    var result=modules.runner.deploySystem(resources,{action:'install-from-image',workflow:workflow,
                        workspace:source.workspace,
                        volumeName:finalRow.name,approval:approval,source:source,host:inventory.host,
                        hostApprovals:hardwareDecision.approvals,installationModel:selectedModel,modelApprovals:hardwareDecision.modelApprovals,
                        nvmeCandidate:candidate,diagnosticsRequested:session.state().enabled,protectedPaths:paths,protectedIDs:session.protectedVolumeIDs()},session,modules.workerLaunch);
                    if(!result || result.kind!=='mavericks-direct-installation' || result.verified!==true)throw new Error('Mavericks installation did not finish verification.');
                    return result;
                });
            },
            installPrepared:function(prepared,selected,sourcePaths,hardwareDecision,workflow){
                workflow=workflow || 'direct';
                if(workflow!=='direct')throw new Error('Unknown installation workflow.');
                modules.copySystem.verifyPrepared(prepared);
                if(!hardwareDecision || !hardwareDecision.accepted || !hardwareDecision.host || hardwareDecision.profile!==prepared.profile)throw new Error('Confirm the Mac compatibility warnings for this prepared system first.');
                var selectedModel=modules.installModel.confirmed(hardwareDecision.host,hardwareDecision.installationModel,hardwareDecision.modelApprovals,modules.compatibility);
                if(selectedModel.profile!==prepared.profile)throw new Error('The prepared system differs from the selected installation model.');
                var paths=(sourcePaths||[]).concat([prepared.image.path,prepared.manifest]);
                function fresh(identity){
                    var current=modules.runtime.inventory([resources].concat(paths),session.protectedVolumeIDs());
                    if(current.host.model!==hardwareDecision.host.model || current.host.board!==hardwareDecision.host.board)throw new Error('The Mac differs from the confirmed hardware.');
                    var matches=current.partitions.filter(function(p){return modules.policy.unchanged(identity,modules.policy.identity(p.info),false);});
                    if(matches.length!==1)throw new Error('The selected partition changed or is no longer available.');
                    var p=matches[0],reason=modules.policy.targetReason(p.info,p.whole,current.protectedIDs,workflow);
                    if(reason)throw new Error(reason);
                    return modules.partitionView.row(p.info,p.whole);
                }
                var approval=modules.dialogs.confirmFormatting(selected,fresh,workflow);if(!approval)return null;
                var finalRow=fresh(approval.target),inventory=modules.runtime.inventory([resources].concat(paths),session.protectedVolumeIDs());
                if(finalRow.name!==selected.name)throw new Error('The selected partition name changed. Select it again.');
                return session.operation('install-mavericks',{partition:approval.target},function(){
                    var result=modules.runner.deploySystem(resources,{action:'deploy-prepared-system',workflow:workflow,
                        workspace:prepared.image.path.slice(0,prepared.image.path.lastIndexOf('/')).replace(/\/[^/]+$/,''),
                        volumeName:finalRow.name,approval:approval,prepared:prepared,host:inventory.host,
                        hostApprovals:hardwareDecision.approvals,installationModel:selectedModel,modelApprovals:hardwareDecision.modelApprovals,
                        nvmeCandidate:prepared.candidate,protectedPaths:paths,protectedIDs:session.protectedVolumeIDs()},session,modules.workerLaunch);
                    if(!result || result.kind!=='mavericks-direct-installation' || result.verified!==true)throw new Error('Mavericks installation did not finish verification.');
                    return result;
                });
            },
            perform: session.operation,
            close: function () {
                broadcasters.forEach(function (module) { module.setDiagnostic(null); });
                row.dispose();
            }
        };
        return api;
    }
    return {create: create};
}());
