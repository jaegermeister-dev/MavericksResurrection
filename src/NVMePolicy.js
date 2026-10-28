/* Optional driver experiments: protocol changes guidance, never forces a driver. */
var MavericksNVMePolicy = (function () {
    'use strict';
    var buttonTitle = 'Install experimental NVMe support';
    var slots = ['System/Library/Extensions/IONVMeFamily.kext', 'System/Library/Extensions/NVMeGeneric.kext'];
    var cacheRoot = 'System/Library/Caches/com.apple.kext.caches';
    function notice(storage, targetDisk) {
        storage = storage || [];
        if (targetDisk && targetDisk.Internal === false && targetDisk.BusProtocol === 'USB') {
            return 'You selected an external USB installation. Experimental NVMe support is usually unnecessary for starting Mavericks from USB and is not recommended for this installation. You can choose Try anyway if you wish, and later remove or reinstall NVMe support.';
        }
        if (storage.some(function (s) { return s.protocol === 'NVMExpress'; })) {
            return 'Internal NVMExpress storage was detected. For an internal installation, trying an experimental NVMe driver is recommended, but successful startup is not guaranteed. Choose Not now to continue without one. An external USB installation remains an alternative. You can return to this macOS to install or remove NVMe support.';
        }
        if (storage.some(function (s) { return s.protocol === 'SATA'; })) {
            return 'Your internal storage is reported as SATA. Experimental NVMe support are not recommended for normal installation. If your Mavericks installation fails to boot, you can try it as a troubleshooting option, though it may not resolve the problem. You can return to this macOS to install or remove experimental NVMe support.';
        }
        return 'The internal storage protocol could not be confirmed. Experimental NVMe support may not help. If you choose to try one, you can return to this macOS to remove experimental NVMe support.';
    }
    function offer(storage, targetDisk) {
        var usb = targetDisk && targetDisk.Internal === false && targetDisk.BusProtocol === 'USB';
        return {message: notice(storage, targetDisk), actions: [
            {id: 'choose-driver', label: usb ? 'Try anyway' : 'Yes, install NVMe support'},
            {id: 'not-now', label: 'No, continue without it'}
        ], selectedCandidate: null, defaultAction: 'not-now'};
    }
    function candidate(catalog, key) {
        if (!catalog || !Array.isArray(catalog.candidates)) throw new Error('NVMe candidate catalog is missing.');
        var found = catalog.candidates.filter(function (c) { return c.id === key; });
        if (found.length !== 1) throw new Error('Select one available experimental candidate.');
        var c = found[0];
        if (!c.payloadVerified || !c.reversible || !Array.isArray(c.drivers) || !c.drivers.length) {
            throw new Error('This candidate is not prepared for reversible installation.');
        }
        var paths = [], ids = [];
        c.drivers.forEach(function (driver) {
            if (slots.indexOf(driver.path) < 0 || paths.indexOf(driver.path) >= 0 ||
                !/^[-a-zA-Z0-9._]+$/.test(driver.bundleID) || ids.indexOf(driver.bundleID) >= 0 ||
                !/^[a-f0-9]{64}$/.test(driver.manifestSHA256)) {
                throw new Error('Candidate contains an unsupported or duplicate driver location.');
            }
            paths.push(driver.path); ids.push(driver.bundleID);
        });
        return JSON.parse(JSON.stringify(c));
    }
    function cacheRecords(c) {
        var rows=[];
        c.drivers.forEach(function(d){
            rows.push({id:d.bundleID,path:'/'+d.path});
            (d.cacheDependencies||[]).forEach(function(dep){
                var expected='System/Library/Extensions/IONVMeFamily.kext/Contents/PlugIns/MavericksNVMeCompatibility.kext';
                if(d.bundleID!=='com.apple.iokit.IONVMeFamily'||d.path!=='System/Library/Extensions/IONVMeFamily.kext'||
                    dep.id!=='dev.Jaegermeister.MavericksNVMeCompatibility'||dep.path!=='/'+expected||dep.version!=='0.1.0d1'||
                    !d.files[expected+'/Contents/Info.plist']||!d.files[expected+'/Contents/MacOS/MavericksNVMeCompatibility'])throw new Error('Unrecognized NVMe cache dependency.');
                rows.push({id:dep.id,path:dep.path});
            });
        });
        var seen={};rows.forEach(function(r){if(seen[r.id])throw new Error('Duplicate NVMe cache dependency.');seen[r.id]=true;});
        return rows;
    }
    function recommend(catalog,inventory,storage) {
        var key='high-sierra-generic-r1';
        var available=catalog.candidates.some(function(c){return c.id===key;});
        var internal=inventory.internalDisks||[], matched=[];
        function disks(node,found){
            if(node.Whole===true&&internal.indexOf(node['BSD Name'])>=0&&found.indexOf(node['BSD Name'])<0)found.push(node['BSD Name']);
            (node.IORegistryEntryChildren||[]).forEach(function(c){disks(c,found);});
        }
        (inventory.nvmeControllers||[]).forEach(function(c){
            var found=[];disks(c,found);
            if(found.length&&c['Physical Interconnect Location']==='Internal'&&
                (c.CFBundleIdentifierKernel||c.CFBundleIdentifier)==='com.apple.iokit.IONVMeFamily'&&c.IOClass==='IONVMeController')matched.push(c);
        });
        var caveat='This is a suggestion for testing, not a guarantee. You can install the available High Sierra-based driver or continue without it. This check describes the SSD inside the Mac running this app; it may not describe another Mac you intend to use.';
        if(available&&matched.length===1)return {candidate:key,basis:'loaded-controller',message:'Suggested first experiment: High Sierra NVMe. This Mac’s internal SSD uses Apple’s IONVMeFamily / IONVMeController, which is the controller implementation this experiment is based on. '+caveat};
        // Bounded fallback: only drive models for which we have actual evidence.
        // An unknown host driver or model never blocks manual driver selection.
        var names=[];
        function models(value,depth){
            if(!value||typeof value!=='object'||depth>12)return;
            Object.keys(value).forEach(function(k){var v=value[k];if(typeof v==='string'&&/^(?:_name|model|device_model|model_number)$/i.test(k))names.push(v);else if(typeof v==='object')models(v,depth+1);});
        }
        models(inventory.storageReport&&inventory.storageReport.SPNVMeDataType,0);
        var known=names.some(function(s){return /^APPLE SSD SM0256L$/i.test(s.trim())||/^PC SN740 NVMe WD 256GB$/i.test(s.trim());});
        if(available&&known&&storage.some(function(s){return s.protocol==='NVMExpress';}))return {candidate:key,basis:'known-model-fallback',message:'The loaded NVMe driver could not be matched reliably. Based on the reported SSD model, High Sierra NVMe is a suggested first experiment. '+caveat};
        return {candidate:null,basis:'unknown',message:'We could not determine which experimental driver to recommend from this Mac’s loaded driver and SSD model. Compatibility with this SSD is unknown. You can still try the available High Sierra-based driver and remove it from this macOS if needed. '+caveat};
    }

    function plan(catalog, key, target) {
        if (!target || target.productVersion !== '10.9.5' || typeof target.productBuild !== 'string' || !/^13F[0-9]+$/.test(target.productBuild) ||
            target.isInstaller !== false || target.isRunningOS !== false || target.writable !== true ||
            !target.partitionUUID || !target.volumeUUID) {
            throw new Error('Choose an offline writable Mavericks 10.9.5 installation.');
        }
        var c = key === 'original' ? null : candidate(catalog, key);
        return {action: c ? 'switch' : 'restore-original', candidate: c,
            productVersion:target.productVersion, productBuild:target.productBuild,
            partitionUUID: target.partitionUUID, volumeUUID: target.volumeUUID,
            driverSlots: slots.slice(), cacheRoot: cacheRoot,
            format: false, partition: false, reinstall: false};
    }
    return {notice: notice, offer: offer, candidate: candidate, cacheRecords: cacheRecords, recommend: recommend, plan: plan, buttonTitle: buttonTitle,
        removeButtonTitle: 'Remove experimental NVMe support'};
}());
if (typeof module !== 'undefined') module.exports = MavericksNVMePolicy;
