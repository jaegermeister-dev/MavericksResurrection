/* Complete only a NEW private image. Existing user installations never enter here. */
var MavericksResurrectionStageCleanup = (function () {
    'use strict';
    var paths = [
        {path:'private/tmp', contentsOnly:true},
        {path:'private/var/tmp', contentsOnly:true},
        {path:'.PKInstallSandboxManager', contentsOnly:false},
        {path:'System/Library/Caches/com.apple.kernelcaches', contentsOnly:false}
    ];
    function prepare(io, setup) {
        if (!setup || !setup.caches || setup.caches.completed !== true || !setup.boot || setup.boot.completed !== true ||
            setup.boot.profile !== setup.caches.profile || !setup.runtime || !setup.runtime.firstBoot ||
            setup.runtime.firstBoot.configured !== true || setup.runtime.firstBoot.runConfirmed !== false) throw new Error('Fresh image setup must finish before temporary files are removed.');
        io.assertFreshStage();
        var protectedFiles = io.captureProtectedFiles(setup), archived = [];
        paths.forEach(function (p) {
            var result = io.archiveAndClean(p.path, p.contentsOnly);
            if (result) {
                if (result.path !== p.path || result.contentsOnly !== p.contentsOnly || result.readbackVerified !== true || result.removalVerified !== true) throw new Error('Temporary-file preservation or cleanup did not verify.');
                archived.push(result);
            }
        });
        io.verifyProtectedFiles(protectedFiles);
        io.assertFreshStage();
        return {kind:'mavericks-stage-cleanup', completed:true, preservedBeforeRemoval:archived,
            criticalFilesUnchanged:true, physicalMutation:false};
    }
    return {prepare:prepare};
}());
if (typeof module !== 'undefined') module.exports = MavericksResurrectionStageCleanup;
