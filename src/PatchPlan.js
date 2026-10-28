/* Exact released model policy. This module describes patches; it never writes files. */
var MavericksPatchPlan = (function () {
    'use strict';
    var boards = {'MacBookPro11,4': 'Mac-06F11FD93F0323C5', 'MacBookPro11,5': 'Mac-06F11F11946D27C5'};
    var shared = [
        'System/Library/Extensions/IOBluetoothFamily.kext',
        'System/Library/Extensions/AppleMultitouchDriver.kext',
        'System/Library/Extensions/AppleTopCase.kext',
        'System/Library/Extensions/AppleUSBMultitouch.kext',
        'System/Library/Extensions/AppleHDA.kext',
        'System/Library/Extensions/AppleCameraInterface.kext',
        'System/Library/Extensions/IO80211Family.kext',
        'Library/Extensions/WiFiCompat.kext',
        'Library/CoreMediaIO/Plug-Ins/DAL/AppleCamera.plugin',
        'System/Library/PrivateFrameworks/AppleVPA.framework'
    ];
    var graphicsPower = [
        'System/Library/Extensions/AMD7000Controller.kext',
        'System/Library/Extensions/AppleGraphicsControl.kext',
        'System/Library/Extensions/AppleGraphicsPowerManagement.kext',
        'System/Library/Extensions/AppleIntelFramebufferAzul.kext',
        'System/Library/Extensions/IOPlatformPluginFamily.kext'
    ];
    function plan(model, board, workflow) {
        if (workflow !== 'direct') throw new Error('Unknown Mavericks installation workflow.');
        var known = Object.prototype.hasOwnProperty.call(boards, model);
        if (known && board !== boards[model]) throw new Error('The detected model and board ID disagree. The released patches require the correct pair.');
        if (!known) return {profile: 'stock', installerEligibility: [], installedPaths: [],
            includePostInstallPatcher: false, normalizeCameraPermissions: false};
        var paths = [{source: 'payload/platform/PlatformSupport.plist', target: 'System/Library/CoreServices/PlatformSupport.plist'}];
        shared.forEach(function (path) { paths.push({source: 'payload/shared/' + path, target: path}); });
        if (model === 'MacBookPro11,5') graphicsPower.forEach(function (path) {
            paths.push({source: 'payload/model-11,5/' + path, target: path});
        });
        return {profile: model, installerEligibility: [],
            installedPaths: paths, includePostInstallPatcher: false,
            normalizeCameraPermissions: true};
    }
    return {plan: plan};
}());
if (typeof module !== 'undefined') module.exports = MavericksPatchPlan;
