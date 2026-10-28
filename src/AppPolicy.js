/* UI messages and install request construction; no filesystem side effects. */
var MavericksAppPolicy = (function () {
    'use strict';
    var policy = typeof MavericksPolicy !== 'undefined' ? MavericksPolicy : require('./Policy.js');
    function startupNotice(suppressed) {
        if (suppressed === true) return null;
        return {title: 'Back up your important files before proceeding',
            message: 'This program should work, but back up all important files before proceeding. ' +
                'For a new Mavericks installation, the app only offers existing Mac OS Extended (Journaled) partitions. ' +
                'It always reformats the selected partition as Mac OS Extended (Journaled) before installing Mavericks, erasing everything on that partition. ' +
                'You must confirm three times: two confirmation buttons in separate dialogs, then typing CONFIRM (any letter case) in a third dialog. ' +
                'The app does not create, resize or delete partitions. NVMe support installation or removal does not format the partition.',
            checkbox: {label: 'Do not show this message again', checked: false},
            actions: ['Continue', 'Quit']};
    }
    function prepareFormat(info, whole, protectedIDs, approval, stage, workflow) {
        var reason = policy.targetReason(info, whole, protectedIDs, workflow);
        if (reason) throw new Error(reason);
        var target = policy.identity(info);
        if (!policy.formattingApproved(approval, target)) throw new Error('All three format confirmations must refer to this exact partition.');
        if (!stage || stage.verified !== true || !/^[a-f0-9]{64}$/.test(stage.manifestSHA256 || '') ||
            stage.workflow !== workflow) throw new Error('The prepared Mavericks source has not been verified.');
        if (typeof info.VolumeName !== 'string' || !info.VolumeName.length || /[\x00-\x1f\x7f/:]/.test(info.VolumeName)) {
            throw new Error('The existing partition name cannot be used safely.');
        }
        return {workflow: workflow, target: target, volumeName: info.VolumeName,
            preparedSourceSHA256: stage.manifestSHA256,
            format: {executable: '/usr/sbin/diskutil', arguments: ['eraseVolume', 'JHFS+', info.VolumeName, '/dev/' + target.bsd]}};
    }
    return {startupNotice: startupNotice, prepareFormat: prepareFormat};
}());
if (typeof module !== 'undefined') module.exports = MavericksAppPolicy;
