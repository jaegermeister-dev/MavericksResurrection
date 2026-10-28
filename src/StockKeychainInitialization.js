/* Mavericks' stock launchd socket service initializes/checks the system keychain
 * on first use. Verify that complete stock path; never substitute host Security
 * APIs or copy a host keychain. Applies only to a fresh private system image.
 */
var MavericksResurrectionStockKeychainInitialization = (function () {
    'use strict';
    var required = ['usr/sbin/systemkeychain', 'usr/bin/security', 'usr/libexec/security-checksystem',
        'System/Library/LaunchDaemons/com.apple.systemkeychain.plist',
        'System/Library/Frameworks/Security.framework/Versions/A/Security'];
    function verify(io, catalog) {
        io.assertFreshSystem();
        if (!catalog || catalog.schema !== 1 || catalog.version !== '10.9.5' || catalog.build !== '13F34' ||
            catalog.strategy !== 'stock-on-demand' || !Array.isArray(catalog.files) || catalog.files.length !== required.length) throw new Error('Unexpected keychain initialization catalog.');
        var seen = Object.create(null);
        catalog.files.forEach(function (file) {
            if (required.indexOf(file.path) < 0 || seen[file.path] || !/^[a-f0-9]{64}$/.test(file.sha256) ||
                file.bytes <= 0 || file.uid !== 0 || file.gid !== 0 || [420, 493].indexOf(file.mode) < 0) throw new Error('Invalid keychain boot dependency.');
            seen[file.path] = true;
            var actual = io.inspectStockFile(file.path);
            if (!actual || actual.kind !== 'file' || ['bytes', 'sha256', 'uid', 'gid', 'mode'].some(function (key) { return actual[key] !== file[key]; })) throw new Error('Stock keychain boot dependency differs: ' + file.path);
        });
        var launch = io.readStockPlist('System/Library/LaunchDaemons/com.apple.systemkeychain.plist');
        if (launch.Label !== 'com.apple.systemkeychain' || launch.Disabled === true ||
            JSON.stringify(launch.ProgramArguments) !== '["/usr/sbin/systemkeychain","-d"]' ||
            !launch.Sockets || !launch.Sockets.Listener || launch.Sockets.Listener.SockPathName !== '/var/run/systemkeychaincheck.socket' ||
            launch.Sockets.Listener.SockPathMode !== 438) throw new Error('Stock keychain launch service differs.');
        if (io.kind('private/var/run/systemkeychaincheck.done')) throw new Error('Unexpected stale keychain initialization marker in fresh image.');
        var overrides = 'private/var/db/launchd.db/com.apple.launchd/overrides.plist';
        if (io.kind(overrides)) {
            var settings = io.readStockPlist(overrides), service = settings['com.apple.systemkeychain'];
            if (service && service.Disabled === true) throw new Error('Stock keychain service is disabled.');
        }
        var keychain = io.kind('Library/Keychains/System.keychain'), key = io.kind('private/var/db/SystemKey');
        if ((keychain && keychain !== 'file') || (key && key !== 'file') || Boolean(keychain) !== Boolean(key)) throw new Error('Unexpected partial or linked keychain state.');
        return {kind: 'mavericks-stock-keychain-initialization', strategy: 'stock-on-demand', prerequisitesVerified: true,
            observedState: keychain ? 'files-present' : 'not-created-yet', initializationConfirmed: false, firstBootCheckRequired: true};
    }
    return {verify: verify};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionStockKeychainInitialization;
