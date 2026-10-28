/* Confirmed single-partition deployment. The worker supplies the matching copy
 * validator for direct installation. */
var MavericksResurrectionPartitionDeployment = (function () {
    'use strict';
    var policy = typeof MavericksPolicy !== 'undefined' ? MavericksPolicy : require('./Policy.js');
    var app = typeof MavericksAppPolicy !== 'undefined' ? MavericksAppPolicy : require('./AppPolicy.js');
    var copy = typeof MavericksResurrectionCopyPreparedSystem !== 'undefined' ? MavericksResurrectionCopyPreparedSystem : require('./CopyPreparedSystem.js');
    function checkedPlan(snapshot, request, prepared) {
        if (!request || request.workflow!=='direct' || prepared.workflow!==request.workflow || !snapshot || !snapshot.info || !snapshot.whole) throw new Error('A selected partition matching the installation workflow is required.');
        if (policy.freeSpace(snapshot.info) === null) throw new Error('The selected partition free space could not be confirmed.');
        if (snapshot.info.VolumeName !== request.volumeName) throw new Error('The selected partition name changed. Select and confirm it again.');
        if (policy.capacity(snapshot.info) < prepared.audit.logicalFileBytes + 1024 * 1024 * 1024) throw new Error('The selected partition is too small for the prepared Mavericks system.');
        return app.prepareFormat(snapshot.info, snapshot.whole, snapshot.protectedIDs, request.approval, prepared, request.workflow);
    }
    function formatted(before, after, workflow) {
        if (!after || !after.info || !policy.unchanged(policy.identity(before.info), policy.identity(after.info), true) ||
            before.info.VolumeUUID.toLowerCase() === String(after.info.VolumeUUID || '').toLowerCase() ||
            before.info.VolumeName !== after.info.VolumeName || !policy.isJournaledHFS(after.info)) throw new Error('The newly formatted partition could not be identified.');
        if (JSON.stringify(before.layout) !== JSON.stringify(after.layout) || JSON.stringify(before.parent) !== JSON.stringify(after.parent)) throw new Error('Disk or partition-map identity changed during formatting.');
        var reason = policy.targetReason(after.info, after.whole, after.protectedIDs, workflow || 'direct');
        if (reason) throw new Error(reason);
    }
    function deploy(io, request, prepared, copySystem) {
        copy.verifyPrepared(prepared);
        var failure, result, formatStarted = false;
        try {
            checkedPlan(io.snapshot(request), request, prepared);
            io.preflightSource(prepared);
            var before = io.snapshot(request), plan = checkedPlan(before, request, prepared);
            io.record({phase: 'ready-to-format', plan: plan, source: prepared.image.sha256});
            // The native adapter repeats these checks immediately before invoking
            // the fixed eraseVolume command, after every slow source operation.
            formatStarted = true;
            io.formatSelected(plan, before);
            var after = io.snapshot(request);
            formatted(before, after, request.workflow);
            io.record({phase: 'formatted', target: policy.identity(after.info), source: prepared.image.sha256});
            var destination = io.openFormatted(after);
            result = copySystem(destination, prepared);
            if (!result || result.kind !== 'mavericks-system-copy' || result.verified !== true || result.sourceImageSHA256 !== prepared.image.sha256) throw new Error('The destination copy did not complete verification.');
            io.record({phase: 'installed', target: policy.identity(after.info), result: result});
        } catch (error) { failure = error; }
        try { io.close(); } catch (error) { failure = new Error((failure ? String(failure) + '\n' : '') + 'Destination cleanup needs attention: ' + String(error)); }
        if (failure) throw new Error(String(failure) + (formatStarted ? '\nFormatting may have begun. The selected partition may be empty or incomplete; installation has not been confirmed.' : ''));
        return result;
    }
    return {checkedPlan: checkedPlan, formatted: formatted, deploy: deploy};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionPartitionDeployment;
