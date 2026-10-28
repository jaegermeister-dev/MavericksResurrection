/* Logs are opened by the GUI as the user, never by an administrator worker. */
var MavericksResurrectionMacDiagnosticLog = (function () {
    'use strict';
    ObjC.import('Foundation'); ObjC.import('AppKit');
    function adapter() {
        var fm = $.NSFileManager.defaultManager;
        return {now: function () { return new Date().toISOString(); }, open: function (folder) {
            var base = ObjC.unwrap($(folder).stringByStandardizingPath.stringByResolvingSymlinksInPath);
            var attributes = fm.attributesOfItemAtPathError($(base), null);
            if (!attributes || attributes.isNil() || ObjC.unwrap(attributes.objectForKey($.NSFileType)) !== 'NSFileTypeDirectory') throw new Error('The selected log folder is unavailable');
            var name = 'MavericksResurrection-Diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + ObjC.unwrap($.NSUUID.UUID.UUIDString);
            var session = base.replace(/\/$/, '') + '/' + name, error = Ref();
            if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(session), false, $({NSFilePosixPermissions: 448}), error)) throw new Error('Cannot create a diagnostic session folder');
            var file = session + '/MavericksResurrection.log';
            if (!fm.createFileAtPathContentsAttributes($(file), $.NSData.data, $({NSFilePosixPermissions: 384}))) throw new Error('Cannot create the diagnostic log');
            var handle = $.NSFileHandle.fileHandleForWritingAtPath($(file)), closed = false;
            if (!handle || handle.isNil()) throw new Error('Cannot open the diagnostic log');
            return {path: file,
                append: function (line) { handle.writeData($(line).dataUsingEncoding($.NSUTF8StringEncoding)); handle.synchronizeFile; },
                close: function () { if (!closed) { closed = true; handle.closeFile; } }};
        }};
    }
    function chooseFolder() {
        var panel = $.NSOpenPanel.openPanel;
        panel.title = $('Save diagnostic logs');
        panel.message = $('Choose a folder for a diagnostic log you can send for troubleshooting. It includes selected paths, hardware details and the app’s operations.');
        panel.prompt = $('Save logs here'); panel.canChooseDirectories = true; panel.canChooseFiles = false;
        panel.allowsMultipleSelection = false; panel.canCreateDirectories = true;
        try { return Number(panel.runModal) === 1 ? ObjC.unwrap(panel.URL.path) : null; } finally { panel.orderOut(null); panel.close; }
    }
    return {adapter: adapter, chooseFolder: chooseFolder};
}());
