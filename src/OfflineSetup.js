/* Fresh-install setup derived from the verified Mavericks component scripts.
 * Receives an adapter restricted to the newly created private system image.
 * No users, live volumes, host defaults or host directory-service records.
 */
var MavericksOfflineSetup = (function () {
    'use strict';
    var protectedApps = ['Contacts', 'App Store', 'Dictionary', 'DVD Player', 'FaceTime',
        'Calendar', 'Messages', 'iTunes', 'Mail', 'Image Capture', 'Photo Booth', 'Preview',
        'QuickTime Player', 'Stickies', 'Safari', 'System Preferences', 'Time Machine',
        'Utilities/System Information', 'Reminders', 'Notes', 'Game Center'];
    var hidden = ['automount', 'bin', 'cores', 'dev', 'etc', 'mach', 'mach_kernel', 'private',
        'sbin', 'tmp', 'Trash', 'usr', 'var', 'VM Storage', 'Volumes', 'Desktop DB', 'Desktop DF',
        'Desktop Folder', 'lost+found', 'mach.sym', 'opt', '.hidden', '.vol',
        'Network', 'Mac OS 9/Desktop Folder', 'System/Library/CoreServices/Finder',
        'Applications/Utilities/Print Center.app', 'mach_kernel.ctfsys'];
    function filesystem(io) {
        io.assertFreshSystem();
        io.progress('Applying Mavericks system-folder permissions (0 of 2 setup stages complete).',0);
        io.acl('Volumes', 'group:everyone deny add_file,add_subdirectory,directory_inherit,only_inherit');
        ['Applications', 'Library', 'Applications/Utilities', 'System'].forEach(function (p) {
            io.acl(p, 'everyone deny delete');
        });
        var templateDirectories = [];
        function templateDirectory(p) {
            if (/\/Sites\/images(?:\/|$)|\/Public\/Drop Box(?:\/|$)/.test(p) || io.kind(p) !== 'directory') return;
            templateDirectories.push(p);
            io.names(p).filter(function (name) { return name.charAt(0) !== '.'; }).forEach(function (name) { templateDirectory(p + '/' + name); });
        }
        io.names('System/Library/User Template').filter(function (name) { return /\.lproj$/.test(name) || name === 'Non_localized'; }).forEach(function (name) {
            var root = 'System/Library/User Template/' + name;
            if (io.kind(root) !== 'directory') throw new Error('Unexpected user-template entry.');
            io.names(root).filter(function (child) { return child.charAt(0) !== '.'; }).forEach(function (child) { templateDirectory(root + '/' + child); });
        });
        if (io.acls) io.acls(templateDirectories, 'everyone deny delete');
        else templateDirectories.forEach(function (p) { io.acl(p, 'everyone deny delete'); });
        var about = 'System/Library/User Template/Non_localized/Downloads/About Downloads.lpdf';
        if (io.kind(about)) { io.clearACL(about); }
        protectedApps.forEach(function (name) { io.acl('Applications/' + name + '.app', 'everyone deny delete'); });
        io.permissions('Applications', '0775');
        io.touch('.DS_Store'); io.permissions('.DS_Store', '0664', '0:80');
        [['Library/Java', '0775', '0:80'], ['Library/Java/Extensions', '0775', '0:80'],
         ['Library/Speech', '0755', '0:0'], ['Library/Speech/Synthesizers', '0755', '0:0']].forEach(function (entry) {
            io.directory(entry[0]); io.permissions(entry[0], entry[1], entry[2]);
        });
        if (!io.kind('Library/Printers/PPDs')) { io.directory('Library/Printers/PPDs'); io.permissions('Library/Printers/PPDs', '0775', '0:80'); }
        io.touch('Library/Receipts/BSD.pkg');
        [['.AppleBundledSoftware.plist', 'private/var/db/.MASManifest'],
         ['.PhysicalMediaInstall', 'private/var/db/.PhysicalMediaInstall']].forEach(function (entry) {
            if (io.kind(entry[0])) io.move(entry[0], entry[1]);
        });
        if (io.kind('private/var/db/.MASManifest')) io.permissions('private/var/db/.MASManifest', '0664', '0:0');
        var airport = 'System/Library/CoreServices/AirPort Base Station Agent.app/Contents/Resources/com.apple.AirPortBaseStationAgent.plist';
        if (io.kind(airport)) io.copyFile(airport, 'System/Library/LaunchAgents/com.apple.AirPortBaseStationAgent.plist');
        if (io.kind('home')) {
            if (io.kind('home') !== 'directory') throw new Error('Unexpected fresh-install home entry.');
            if (io.names('home').length) io.move('home', 'home-preserved');
            else io.removeEmpty('home');
        }
        hidden.forEach(function (p) { if (io.kind(p)) io.hide(p); });
        io.directory('Library/Keychains'); io.permissions('Library/Keychains', '0755', '0:0');
        return {kind: 'mavericks-filesystem-setup', completed: true};
    }
    function tools(io) {
        io.assertFreshSystem();
        io.progress('Preparing Mavericks initialization (1 of 2 setup stages complete).',50);
        var keychain = io.verifyStockKeychainInitialization();
        if (!keychain || !keychain.prerequisitesVerified || keychain.strategy !== 'stock-on-demand') throw new Error('Stock keychain initialization was not verified.');
        io.targetTool('/usr/libexec/makewhatis', []);
        if (io.kind('System/Library/Keychains/X509Certificates')) io.move('System/Library/Keychains/X509Certificates', 'System/Library/Keychains/X509Certificates.obsoleted');
        var firstBoot = io.prepareFirstBootSetup();
        if (!firstBoot || firstBoot.kind !== 'mavericks-first-boot-prepared' || firstBoot.configured !== true || firstBoot.runConfirmed !== false) throw new Error('Automatic first-boot setup was not configured.');
        return {kind: 'mavericks-runtime-preparation', completed: true, stockKeychain: keychain, firstBoot: firstBoot, nativeInitializationConfirmed: false};
    }
    function apply(io) {
        io.progress('Mavericks setup: 0 of 2 stages complete.',0);
        filesystem(io);
        io.progress('Mavericks system-folder setup complete: 1 of 2 stages.',50);
        var runtime = tools(io);
        io.progress('Mavericks setup: both stages complete.',100);
        return {kind: 'mavericks-offline-setup', completed: true, runtime: runtime,
            pending: ['selected-model-patches', 'optional-nvme', 'cache-generation', 'final-verification']};
    }
    return {apply: apply, filesystem: filesystem, tools: tools};
}());
if (typeof module !== 'undefined') module.exports = MavericksOfflineSetup;
