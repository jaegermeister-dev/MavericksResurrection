/*
 * Recovery protocol, shared with the macOS driver-maintenance adapter.
 * All persistent state is per Mavericks volume, with an immutable baseline.
 * Adapter methods MUST bind to the frozen partition/volume UUIDs and confine
 * driver writes to the plan's exact slots. They must never format/install an OS.
 * Snapshots include driver metadata, all kext caches, directory timestamps and
 * active-candidate state. 'Absent' paths must restore to absent. Saves are durable
 * before this controller allows any driver/cache mutation.
 */
var MavericksNVMeTransaction = (function () {
    'use strict';
    function validatePlan(plan) {
        if (!plan || (plan.action !== 'switch' && plan.action !== 'restore-original') ||
            plan.format !== false || plan.partition !== false || plan.reinstall !== false ||
            JSON.stringify(plan.driverSlots) !== JSON.stringify(['System/Library/Extensions/IONVMeFamily.kext', 'System/Library/Extensions/NVMeGeneric.kext']) ||
            plan.cacheRoot !== 'System/Library/Caches/com.apple.kext.caches' ||
            (plan.action === 'switch' && !plan.candidate) ||
            (plan.action === 'restore-original' && plan.candidate !== null)) {
            throw new Error('Invalid driver-maintenance plan. Formatting and reinstalling are not permitted.');
        }
    }
    function recover(io, target) {
        io.assertIdentity(target);
        io.assertOfflineMavericks();
        var pending = io.pending();
        if (!pending) return {status: 'nothing-to-recover'};
        // Reverting to the previous state is also correct after a crash between
        // durable active-state write and transaction completion. No ambiguity.
        io.verifySnapshot(pending.snapshot);
        io.restoreSnapshot(pending.snapshot);
        io.verifyRestoredSnapshot(pending.snapshot);
        io.finishRecovery(pending);
        return {status: 'recovered', candidate: io.activeCandidate()};
    }
    function run(io, plan) {
        validatePlan(plan);
        io.assertIdentity(plan);
        if (io.pending()) throw new Error('An unfinished NVMe change must be recovered first.');
        io.assertOfflineMavericks();
        io.assertManagedState(); // Unknown driver edits must never be deleted.
        if (plan.candidate) io.verifyCandidatePayload(plan.candidate);
        var baseline = io.ensureOriginalSnapshot(plan);
        io.verifySnapshot(baseline);
        var before = io.snapshotCurrent(plan);
        io.verifySnapshot(before);
        var pending = io.beginPending(before, plan); // atomic write + sync
        try {
            io.assertIdentity(plan);
            // Restore the original driver slots before installing any replacement.
            // Rebuild caches even for removal: old baseline caches may predate
            // unrelated OS changes. Full cache snapshots are for immediate rollback.
            io.restoreOriginalDriverSlots(baseline, plan.driverSlots);
            if (plan.candidate) io.installCandidate(plan.candidate);
            io.rebuildCaches(plan);
            io.verifyDriverAndCacheState(plan);
            io.assertIdentity(plan);
            io.commitActiveState(pending, plan);
            io.complete(pending);
            return {status: 'committed', candidate: plan.candidate ? plan.candidate.id : 'original'};
        } catch (failure) {
            try {
                io.assertIdentity(plan);
                io.verifySnapshot(before);
                io.restoreSnapshot(before);
                io.verifyRestoredSnapshot(before);
                io.finishRecovery(pending);
            } catch (rollbackFailure) {
                // Keep pending marker and verified backup. A reconnect/relaunch
                // can retry recovery; don't announce success or erase evidence.
                var recovery = new Error('The NVMe change failed and recovery is unfinished. Reopen the app with this Mavericks volume connected to recover it.');
                recovery.operationFailure = String(failure);
                recovery.recoveryFailure = String(rollbackFailure);
                recovery.recoveryRequired = true;
                throw recovery;
            }
            var restored = new Error('The NVMe change failed. The previous driver and cache state was restored. ' + String(failure));
            restored.restored = true;
            throw restored;
        }
    }
    return {run: run, recover: recover};
}());
if (typeof module !== 'undefined') module.exports = MavericksNVMeTransaction;
