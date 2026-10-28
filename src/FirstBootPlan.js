/* Automatic stock housekeeping, not post-install driver patching. */
var MavericksResurrectionFirstBootPlan = (function () {
    'use strict';
    var folder = 'Library/Application Support/MavericksResurrection/FirstBoot';
    var ids = ['system-keychain', 'postfix', 'emacs', 'automator', 'input-sources', 'xpc-cache'];
    var programs = ['usr/bin/security', 'usr/sbin/postfix', 'usr/libexec/dumpemacs',
        'System/Library/Frameworks/Automator.framework/Versions/A/Support/update_automator_cache', 'usr/libexec/ifcstart', 'usr/libexec/xpchelper'];
    function plan(installID, diagnosticsRequested, catalog) {
        if (typeof installID !== 'string' || !/^[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12}$/.test(installID) || typeof diagnosticsRequested !== 'boolean') throw new Error('Invalid first-boot setup request.');
        if (!catalog || catalog.schema !== 1 || catalog.version !== '10.9.5' || catalog.build !== '13F34' ||
            !Array.isArray(catalog.files) || catalog.files.length !== programs.length) throw new Error('First-boot input inventory differs.');
        var seen = Object.create(null);
        catalog.files.forEach(function (r) {
            if (programs.indexOf(r.path) < 0 || seen[r.path] || !/^[a-f0-9]{64}$/.test(r.sha256) || r.bytes <= 0 || r.uid !== 0 || r.gid !== 0 || [365, 493].indexOf(r.mode) < 0) throw new Error('Invalid first-boot program identity.');
            seen[r.path] = true;
        });
        var executable = '/' + folder + '/FirstBootSetup';
        return {folder: folder, inputs: catalog.files,
            state: {schema: 1, version: '10.9.5', build: '13F34', installID: installID, phase: 'pending', diagnosticsRequested: diagnosticsRequested,
                steps: ids.map(function (id) { return {id: id, status: 'pending', attempts: 0}; })},
            daemon: {path: 'Library/LaunchDaemons/local.mavericksresurrection.firstboot.plist', content: {
                Label: 'local.mavericksresurrection.firstboot', ProgramArguments: [executable], RunAtLoad: true, ProcessType: 'Background',
                WorkingDirectory: '/', StandardOutPath: '/dev/null', StandardErrorPath: '/dev/null'}},
            notice: {path: 'Library/LaunchAgents/local.mavericksresurrection.firstboot-notice.plist', content: {
                Label: 'local.mavericksresurrection.firstboot-notice', ProgramArguments: [executable, '--notify'], RunAtLoad: true,
                LimitLoadToSessionType: 'Aqua', StandardOutPath: '/dev/null', StandardErrorPath: '/dev/null'}}};
    }
    return {plan: plan};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionFirstBootPlan;
