/* Partition rows and all three confirmation summaries use verified data. */
var MavericksPartitionViewModel = (function () {
    'use strict';
    var policy = typeof MavericksPolicy !== 'undefined' ? MavericksPolicy : require('./Policy.js');
    function row(info, whole) {
        return {identity: policy.identity(info), info: info, whole: whole,
            name: info.VolumeName || '(Unnamed partition)',
            format: info.FilesystemName || info.FileSystemPersonality || 'Mac OS Extended',
            mounted:!!info.MountPoint && info.Mounted!==false,
            capacity: policy.capacity(info), free: policy.freeSpace(info),
            location: whole.Internal === true ? 'Internal' : 'External',
            device: '/dev/' + info.DeviceIdentifier};
    }
    function groups(inventory, workflow) {
        var result = {Internal: [], External: []};
        inventory.partitions.forEach(function (item) {
            var reason = policy.targetReason(item.info, item.whole, inventory.protectedIDs, workflow);
            if(reason){var probe=JSON.parse(JSON.stringify(item.info));if(String(probe.FilesystemType||'').toLowerCase()!=='hfs'||probe.Encrypted===true)return;probe.FilesystemName='Mac OS Extended (Journaled)';probe.FileSystemPersonality='Journaled HFS+';probe.CaseSensitive=false;probe.JournaledHFS=true;probe.Mounted=true;probe.MountPoint=probe.MountPoint||'/Volumes/UNMOUNTED-CANDIDATE';probe.Writable=probe.WritableMedia===true||probe.Writable===true;if(policy.targetReason(probe,item.whole,inventory.protectedIDs,workflow))return;}
            var itemRow = row(item.info, item.whole);
            itemRow.unavailableReason=reason;result[itemRow.location].push(itemRow);
        });
        Object.keys(result).forEach(function (key) {
            result[key].sort(function (a, b) { return a.name.localeCompare(b.name) || a.device.localeCompare(b.device); });
        });
        return result;
    }
    function summary(item) {
        if (item.capacity === null || item.free === null) throw new Error('Refresh partition information to confirm capacity and free space before formatting.');
        return 'Partition name: ' + item.name + '\n' +
            'Format: ' + item.format + '\n' +
            'Capacity: ' + policy.bytes(item.capacity) + '\n' +
            'Free space: ' + policy.bytes(item.free) + '\n' +
            'Location: ' + item.location + '\n' +
            'Device: ' + item.device;
    }
    function firstConfirmation(item,workflow) {
        return {title: 'Confirmation 1 of 3: Check the selected partition', details: summary(item),
            message: 'Everything on this partition will be erased. It will be reformatted as Mac OS Extended (Journaled) before '+'Mavericks is installed.',
            confirmLabel: 'This is the correct partition', cancelLabel: 'Cancel'};
    }
    function secondConfirmation(item,workflow) {
        return {title: 'Confirmation 2 of 3: Confirm erasing this partition', details: summary(item),
            message: 'Check the partition details again. Every file on this partition will be erased before '+'Mavericks is installed.'+' Continue only if this is the partition you intend to erase.',
            confirmLabel: 'Confirm selected partition', cancelLabel: 'Cancel'};
    }
    function thirdConfirmation(item,workflow) {
        return {title: 'Confirmation 3 of 3: Type CONFIRM', details: summary(item),
            message: 'Type CONFIRM to approve formatting this partition. Letter case does not matter.',
            confirmLabel: 'Format and install', cancelLabel: 'Cancel'};
    }
    return {row: row, groups: groups, summary: summary,
        firstConfirmation: firstConfirmation, secondConfirmation: secondConfirmation, thirdConfirmation: thirdConfirmation};
}());
if (typeof module !== 'undefined') module.exports = MavericksPartitionViewModel;
