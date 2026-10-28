/* Build a private HFS+ system image and install verified Apple payloads. A
 * prepared-source receipt additionally requires setup, patches, caches, cleanup
 * and final read-only verification. Deployment/boot success is separate.
 */
var MavericksStagePackages = (function () {
    'use strict';
    function installedReceipt(installed, setup, image, job) {
            var firstBoot = setup && setup.runtime && setup.runtime.firstBoot;
            if (setup && (!setup.runtime || setup.runtime.kind !== 'mavericks-runtime-preparation' ||
                setup.runtime.completed !== true || setup.runtime.nativeInitializationConfirmed !== false || !firstBoot ||
                firstBoot.kind !== 'mavericks-first-boot-prepared' || firstBoot.configured !== true ||
                firstBoot.runConfirmed !== false || !/^[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12}$/.test(firstBoot.installID))) {
                throw new Error('Automatic first-boot setup was not prepared; native initialization must remain unconfirmed.');
            }
            var modelPatches = setup && setup.modelPatches;
            if (modelPatches && (modelPatches.kind !== 'mavericks-model-patches' || modelPatches.completed !== true ||
                ['stock', 'MacBookPro11,4', 'MacBookPro11,5'].indexOf(modelPatches.profile) < 0)) throw new Error('Model patch stage did not complete.');
            var caches = setup && setup.caches;
            var nvme = setup && setup.nvme;
            if (nvme && (nvme.kind !== 'mavericks-initial-nvme' || nvme.completed !== true ||
                (nvme.candidate !== null && (typeof nvme.candidate !== 'string' || !nvme.state || !/^[a-f0-9]{64}$/.test(nvme.state.sha256))))) throw new Error('Initial NVMe stage did not complete.');
            if (caches && (!modelPatches || caches.kind !== 'mavericks-cache-preparation' || caches.completed !== true ||
                caches.profile !== modelPatches.profile || !/^[a-f0-9]{64}$/.test(caches.kernelcacheSHA256) ||
                (nvme && caches.candidate !== nvme.candidate))) throw new Error('Cache stage did not complete for this model or NVMe selection.');
            var boot = setup && setup.boot;
            if (boot && (!caches || boot.kind !== 'mavericks-boot-preparation' || boot.completed !== true ||
                boot.profile !== modelPatches.profile || boot.startupDiskChanged !== false || !boot.bootEFI ||
                boot.bootEFI.sha256 !== '72f3225ff8efadc607086b5778a328918a7fffbb763cad682b0bb29ed31a4795')) throw new Error('Boot preparation did not complete for this image.');
            var cleanup = setup && setup.cleanup;
            if (cleanup && (!boot || cleanup.kind !== 'mavericks-stage-cleanup' || cleanup.completed !== true ||
                cleanup.criticalFilesUnchanged !== true || !Array.isArray(cleanup.preservedBeforeRemoval))) throw new Error('Private image cleanup did not complete.');
            var receipt = {kind: 'mavericks-packages-staged', image: image, job: job, version: '10.9.5', build: '13F34',
                installedPackages: installed, offlineSetup: setup, firstBoot: firstBoot || null,
                nativeInitializationConfirmed: false, requiredOnFirstBoot: firstBoot ? ['native-mavericks-housekeeping'] : [],
                modelPatches: modelPatches || null, nvme: nvme || null, caches: caches || null, boot: boot || null, cleanup: cleanup || null, verified: false,
                requiredNextPhases: (setup ? [] : ['offline-setup']).concat(modelPatches ? [] : ['selected-model-patches'],
                    nvme ? [] : ['optional-nvme'], caches ? [] : ['cache-generation'], boot ? [] : ['boot-preparation'],
                    cleanup ? [] : ['staging-cleanup'], ['final-verification'])};
            return receipt;
    }
    function prepare(io, frozen, workspace, catalog, sourceManifest, packagePreparation, afterPackages, finalVerification) {
        packagePreparation.catalogCheck(catalog);
        var job = io.createJob(workspace, 'system-stage');
        io.ensureFree(job, 40 * 1024 * 1024 * 1024);
        var image = io.createInstalledImage(job), stage = io.attachInstalledImage(image, job);
        var failure, receipt;
        try {
            var installed = packagePreparation.withComponents(io, frozen, job, catalog, sourceManifest, function (component) {
                io.progress('install-package', 'Installing ' + component.name + ' into the private Mavericks image.');
                io.installComponent(component, stage);
            });
            var version = io.inspectStagedVersion(stage);
            if (version.ProductVersion !== '10.9.5' || version.ProductBuildVersion !== '13F34') throw new Error('The staged OS version differs from Mavericks 10.9.5 build 13F34.');
            var setup = null;
            if (afterPackages) {
                setup = afterPackages(stage);
                if (!setup || setup.kind !== 'mavericks-offline-setup' || setup.completed !== true) throw new Error('Offline setup did not complete.');
            }
            receipt = installedReceipt(installed, setup, image, job);
        } catch (error) { failure = error; }
        try { io.detach(stage); }
        catch (error) { throw new Error((failure ? String(failure) + '\n' : '') + 'The private system image could not be detached. Retained workspace: ' + job + '\n' + String(error)); }
        if (failure) throw failure;
        if(finalVerification) {
            if(receipt.requiredNextPhases.join(',')!=='final-verification')throw new Error('The private image is not ready for final verification.');
            var prepared=finalVerification(receipt);
            if(!prepared || prepared.kind!=='mavericks-prepared-image' || prepared.verified!==true || prepared.workflow!=='direct' ||
                !prepared.image || prepared.image.path!==receipt.image || !/^[a-f0-9]{64}$/.test(prepared.image.sha256) ||
                !/^[a-f0-9]{64}$/.test(prepared.manifestSHA256) || prepared.profile!==receipt.modelPatches.profile ||
                prepared.candidate!==receipt.nvme.candidate || !prepared.firstBoot || prepared.firstBoot.installID!==receipt.firstBoot.installID ||
                prepared.nativeInitializationConfirmed!==false || prepared.bootTested!==false)throw new Error('Final image verification did not complete.');
            receipt.prepared=prepared;receipt.verified=true;receipt.requiredNextPhases=[];
        }
        io.writeStageReceipt(job, receipt);
        return receipt;
    }
    return {prepare: prepare, installedReceipt: installedReceipt};
}());
if (typeof module !== 'undefined') module.exports = MavericksStagePackages;
