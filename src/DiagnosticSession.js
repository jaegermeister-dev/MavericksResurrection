/* One GUI-owned diagnostic session shared across all app workflows. */
var MavericksResurrectionDiagnosticSession = (function () {
    'use strict';
    function create(logs, io, chooseFolder, warn, changed, resolveVolume) {
        var log = logs.create(io, null, warn), busy = false, closed = false, retained = [], volumeIDs = [];
        function remember() {
            log.protectedPaths().forEach(function (path) { if (retained.indexOf(path) < 0) retained.push(path); });
        }
        function state() { return {enabled: log.enabled(), busy: busy, closed: closed, path: log.path()}; }
        function refresh() { remember(); try { if (changed) changed(state()); } catch (_) {} }
        function record(event, detail) { log.record(event, detail); refresh(); }
        function setEnabled(enabled) {
            if (busy || closed) return state();
            if (enabled === true && !log.enabled()) {
                var folder = chooseFolder();
                if (folder === null || folder === undefined) return state();
                remember(); log.close('logging destination changed');
                log = logs.create(io, folder, warn);
                if (log.enabled() && resolveVolume) {
                    try {
                        var id = resolveVolume(log.path());
                        if (typeof id !== 'string' || !/^disk[0-9]+(?:s[0-9]+)+$/.test(id)) throw new Error('Unknown log volume');
                        if (volumeIDs.indexOf(id) < 0) volumeIDs.push(id);
                    } catch (error) {
                        // A log destination that cannot be identified must not
                        // stop installation or accidentally become a format target.
                        log.close('log volume unavailable');
                        try { if (warn) warn('Diagnostic file logging stopped because its volume could not be identified. Your operation can continue.'); } catch (_) {}
                    }
                }
                log.record('application.diagnostics.enabled', {selectedFolder: folder});
            } else if (enabled !== true) {
                remember(); log.close('logging disabled by user');
                log = logs.create(io, null, warn);
            }
            refresh(); return state();
        }
        function operation(name, details, work) {
            if (closed || busy) throw new Error('The application session cannot start another operation.');
            busy = true; record('operation.started', {name: name, request: details});
            try {
                var result = work(); record('operation.completed', {name: name, result: result}); return result;
            } catch (error) {
                record('operation.failed', {name: name, message: String(error)}); throw error;
            } finally { busy = false; refresh(); }
        }
        // Capture resolved volume identities when a destination is chosen. The
        // caller retains these IDs even if the log device is later disconnected.
        function protectedPaths(other) {
            remember(); var all = (other || []).slice();
            retained.forEach(function (path) { if (all.indexOf(path) < 0) all.push(path); });
            return all;
        }
        return {state: state, setEnabled: setEnabled, record: record, operation: operation,
            protectedPaths: protectedPaths,
            protectedVolumeIDs: function () { return volumeIDs.slice(); },
            close: function (outcome) { if (!closed) { remember(); log.close(outcome); closed = true; refresh(); } }};
    }
    return {create: create};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionDiagnosticSession;
