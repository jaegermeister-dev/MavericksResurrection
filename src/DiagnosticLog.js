/* Optional session diagnostics. Log I/O failures cannot interrupt app work. */
var MavericksResurrectionDiagnosticLog = (function () {
    'use strict';
    function sanitize(value, key) {
        if (key && /password|passphrase|authorization|private.?key|secret|token|cookie/i.test(key)) return '[redacted]';
        if (typeof value === 'string') return value
            .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[private key redacted]')
            .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)\S+/gi, '$1[redacted]')
            .replace(/([?&](?:token|access_token|password|secret)=)[^&\s]+/gi, '$1[redacted]');
        if (Array.isArray(value)) return value.map(function (v) { return sanitize(v); });
        if (value && typeof value === 'object') {
            var result = {};
            Object.keys(value).forEach(function (name) { result[name] = sanitize(value[name], name); });
            return result;
        }
        return value;
    }
    function create(io, folder, warn) {
        var writer = null, failed = false, sequence = 0, closed = false, path = null;
        function failure(error) {
            if (failed) return;
            failed = true;
            try { if (writer) writer.close(); } catch (_) {}
            writer = null;
            try { if (warn) warn('Diagnostic file logging stopped: ' + String(error) + '. Your operation can continue.'); } catch (_) {}
        }
        function record(event, detail) {
            if (!writer || failed || closed) return;
            try {
                writer.append(JSON.stringify({time: io.now(), sequence: ++sequence,
                    event: String(event), detail: sanitize(detail)}) + '\n');
            } catch (error) { failure(error); }
        }
        if (folder !== null && folder !== undefined) {
            try {
                if (typeof folder !== 'string' || folder.charAt(0) !== '/' || /[\x00-\x1f]/.test(folder)) throw new Error('Choose an absolute diagnostic folder path');
                writer = io.open(folder); path = writer.path;
                record('session.started', {application: 'MavericksResurrection', format: 'JSON lines', schema: 1});
            } catch (error) { failure(error); }
        }
        return {record: record,
            enabled: function () { return !!writer && !failed && !closed; },
            path: function () { return path; },
            protectedPaths: function () { return path ? [path] : []; },
            close: function (outcome) {
                if (closed) return;
                record('session.finished', {outcome: outcome}); closed = true;
                try { if (writer) writer.close(); writer = null; } catch (error) { failure(error); }
            }};
    }
    return {create: create, sanitize: sanitize};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionDiagnosticLog;
