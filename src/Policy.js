/* Shared, side-effect-free policy used by the Cocoa UI, worker and fixture tests. */
var MavericksPolicy = (function () {
    'use strict';
    var models = ['MacBookPro11,4', 'MacBookPro11,5'];
    function knownModel(model) { return models.indexOf(model) !== -1; }
    function profile(model, board, compatibility) {
        if (model === 'MacBookPro11,5') return 'patched-11,5';
        if (model === 'MacBookPro11,4') return 'patched-11,4';
        var c = compatibility || {models: [], boards: []};
        if (c.models.indexOf(model) >= 0 || (board && c.boards.indexOf(board) >= 0)) return 'stock';
        return 'unsupported-stock';
    }
    function confirmed(text) { return typeof text === 'string' && text.trim().toLowerCase() === 'confirm'; }
    function hostWarning(model, board, compatibility) {
        if (profile(model, board, compatibility) === 'stock') return '';
        if (model === 'MacBookPro11,4') return 'MacBookPro11,4 has not been tested. Please report any issues.';
        if (model === 'MacBookPro11,5') return '';
        return 'PROCEEDING IS NOT RECOMMENDED. This app was made for MacBookPro11,4 and MacBookPro11,5. Your Mac is ' +
            model + '. It is not in the verified Mavericks compatibility data. A stock installation will be attempted without the 11,4/11,5-specific patches; it may not boot or work correctly. Back up important files. Continue only if you accept these risks.';
    }
    function hostApproved(model, approvals, board, compatibility) {
        return profile(model,board,compatibility)!=='unsupported-stock';
    }
    function creationHostApproved(model,approvals,board,compatibility){return hostApproved(model,null,board,compatibility)||!!(approvals&&approvals.model===model&&approvals.creationHostOnly===true);}
    function bytes(value) {
        if (value === null || value === undefined || value === '') return 'Unknown';
        var n = Number(value);
        if (!isFinite(n) || n < 0) return 'Unknown';
        if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB';
        return (n / 1e9).toFixed(1) + ' GB';
    }
    function parentDevice(info) { return info.ParentWholeDisk || info.PartOfWhole || ''; }
    function id(info) { return info.DeviceIdentifier || ''; }
    function isJournaledHFS(info) {
        var type = String(info.FilesystemType || '').toLowerCase();
        var name = String(info.FilesystemName || info.FileSystemPersonality || '').toLowerCase();
        return type === 'hfs' && name.indexOf('case-sensitive') < 0 && name.indexOf('case sensitive') < 0 &&
            info.CaseSensitive !== true && info.Encrypted !== true &&
            (info.JournaledHFS === true || info.Journaled === true || name.indexOf('journaled') >= 0);
    }
    function numberField(info, keys) {
        for (var i = 0; i < keys.length; i++) {
            var v = info[keys[i]];
            if (typeof v === 'number' && isFinite(v) && v >= 0) return v;
        }
        return null;
    }
    function capacity(info) { return numberField(info, ['TotalSize', 'Size', 'VolumeTotalSpace']); }
    function freeSpace(info) { return numberField(info, ['VolumeFreeSpace', 'FreeSpace']); }
    function validUUID(v) { return typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v); }
    function targetReason(info, whole, protectedIDs, workflow) {
        if (workflow !== 'direct') return 'Unknown installation workflow.';
        if (info.WholeDisk !== false || info.PartitionMapPartition !== true || !/^disk[0-9]+s[0-9]+$/.test(id(info))) return 'Choose a partition, not a whole disk or a logical volume.';
        if (!whole || whole.WholeDisk !== true || !/^disk[0-9]+$/.test(id(whole)) || parentDevice(info) !== id(whole)) return 'Physical parent disk could not be verified.';
        if (id(info).replace(/s[0-9]+$/, '') !== id(whole)) return 'Partition identity disagrees with its parent disk.';
        if (whole.Virtual === true || whole.VirtualOrPhysical === 'Virtual' || whole.BusProtocol === 'Disk Image') return 'Disk images and virtual disks are excluded.';
        if (whole.Content !== 'GUID_partition_scheme') return 'Use an existing partition on a GUID partition map. This app cannot change the partition map.';
        if (info.Content !== 'Apple_HFS' || info.Fusion === true || info.RAIDMaster === true || info.RAIDSlice === true) return 'Use a physical Mac OS Extended (Journaled) partition.';
        if (!isJournaledHFS(info)) return 'Prepare this partition as Mac OS Extended (Journaled) in Disk Utility first.';
        if (!info.MountPoint || info.Mounted === false) return 'This partition is unmounted. Close the app, prepare and mount it in Disk Utility, then reopen the app.';
        if (info.Writable !== true || info.WritableMedia === false || info.WritableVolume === false || whole.Writable !== true) return 'This partition is not writable.';
        if (!validUUID(info.DiskUUID) || !validUUID(info.VolumeUUID)) return 'Partition and volume identifiers are required.';
        if (!(numberField(info, ['PartitionMapPartitionOffset']) > 0)) return 'The partition location could not be verified.';
        if (!Array.isArray(protectedIDs)) return 'Protected volumes have not been identified.';
        if (protectedIDs.indexOf(id(info)) >= 0 || protectedIDs.indexOf(id(whole)) >= 0 || info.MountPoint === '/' || /^\/System(?:\/|$)/.test(info.MountPoint || '')) return 'This partition is in use by macOS, this app, its image or its workspace.';
        if (workflow === 'direct' && whole.Internal !== true && !(whole.Internal === false && whole.BusProtocol === 'USB')) return 'Choose an internal partition or a partition on an external USB device.';
        if (capacity(info) === null || capacity(info) < 20e9) return 'Use a partition of at least 20 GB.';
        return '';
    }
    function identity(info) {
        return {bsd: id(info), parent: parentDevice(info), partitionUUID: info.DiskUUID || '',
            volumeUUID: info.VolumeUUID || '', capacity: capacity(info), offset: numberField(info, ['PartitionMapPartitionOffset'])};
    }
    function unchanged(before, after, afterFormat) {
        if (!before || !after || !validUUID(before.partitionUUID) || !validUUID(after.partitionUUID) ||
            !validUUID(before.volumeUUID) || !validUUID(after.volumeUUID) ||
            !/^disk[0-9]+s[0-9]+$/.test(before.bsd) || !/^disk[0-9]+$/.test(before.parent) ||
            !(before.capacity > 0) || before.offset === null || before.offset === undefined || before.offset <= 0) return false;
        return before.bsd === after.bsd && before.parent === after.parent &&
            before.partitionUUID.toLowerCase() === after.partitionUUID.toLowerCase() && before.capacity === after.capacity && before.offset === after.offset &&
            (afterFormat || before.volumeUUID.toLowerCase() === after.volumeUUID.toLowerCase());
    }
    function formattingApproved(approval, target) {
        return !!(approval && approval.first === true && approval.second === true && confirmed(approval.third) && unchanged(approval.target, target, false));
    }
    function storageCategories(report) {
        // system_profiler's XML/plist output works on the oldest intended host.
        if (!Array.isArray(report)) throw new Error('Unexpected System Information property-list format.');
        var result = {};
        report.forEach(function (category) {
            if (category && (category._dataType === 'SPNVMeDataType' || category._dataType === 'SPSerialATADataType') && Array.isArray(category._items)) {
                result[category._dataType] = (result[category._dataType] || []).concat(category._items);
            }
        });
        return result;
    }
    // System Information's data-type category and BSD identity are the evidence.
    // Marketing/model names never determine SATA versus NVMExpress.
    function detectInternalStorage(profile, internals) {
        var found = [], categories = [['SPNVMeDataType', 'NVMExpress'], ['SPSerialATADataType', 'SATA']];
        function walk(node, kind) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) { node.forEach(function (child) { walk(child, kind); }); return; }
            var devices = [];
            Object.keys(node).forEach(function (key) {
                if (/bsd.*name|bsd.*disk|device_identifier/i.test(key) && typeof node[key] === 'string') {
                    var match = node[key].match(/^(?:\/dev\/)?(disk[0-9]+)(?:s[0-9]+)?$/);
                    if (match && internals.indexOf(match[1]) >= 0) devices.push(match[1]);
                }
            });
            devices.forEach(function (device) {
                if (!found.some(function (x) { return x.bsd === device && x.protocol === kind; })) found.push({bsd: device, protocol: kind, source: 'System Information'});
            });
            Object.keys(node).forEach(function (key) { if (node[key] && typeof node[key] === 'object') walk(node[key], kind); });
        }
        categories.forEach(function (entry) { walk((profile || {})[entry[0]], entry[1]); });
        return found;
    }
    function storageWarning(storage) {
        storage = storage || [];
        if (storage.some(function (x) { return x.protocol === 'NVMExpress'; })) {
            return 'This check describes the Mac running this app, not another Mac you may intend to use. System Information reports internal NVMExpress storage. Mavericks may not boot from that internal drive. You can try an experimental NVMe driver, or choose Not now. Compatibility with other SSD models remains experimental. Installing Mavericks onto an external USB drive is recommended; you can still choose an internal partition if you wish.';
        }
        if (storage.some(function (x) { return x.protocol === 'SATA'; })) {
            return 'This check describes the Mac running this app, not another Mac you may intend to use. System Information reports internal SATA storage. Mavericks should work with that internal storage. This is not a guarantee that installation or startup will succeed. Back up important files before proceeding. You can choose an internal partition or an external USB partition.';
        }
        return 'The internal storage protocol could not be confirmed from System Information, so internal Mavericks compatibility is unknown. You can still try an internal partition or choose an external USB partition. Back up important files before proceeding.';
    }
    return {knownModel: knownModel, profile: profile, confirmed: confirmed, hostWarning: hostWarning, hostApproved: hostApproved, creationHostApproved:creationHostApproved,
        bytes: bytes, parentDevice: parentDevice, isJournaledHFS: isJournaledHFS, targetReason: targetReason,
        capacity: capacity, freeSpace: freeSpace,
        identity: identity, unchanged: unchanged, formattingApproved: formattingApproved,
        storageCategories: storageCategories, detectInternalStorage: detectInternalStorage, storageWarning: storageWarning};
}());
if (typeof module !== 'undefined') module.exports = MavericksPolicy;
