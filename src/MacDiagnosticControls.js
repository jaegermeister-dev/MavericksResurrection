/* Reusable diagnostics row for the main window. Yosemite AppKit APIs only. */
var MavericksResurrectionMacDiagnosticControls = (function () {
    'use strict';
    ObjC.import('Foundation'); ObjC.import('AppKit');
    var controls = {}, next = 0;
    ObjC.registerSubclass({name: 'MavericksResurrectionDiagnosticControlsDelegate', superclass: 'NSObject', methods: {
        'toggleLogs:': {types: ['void', ['id']], implementation: function (sender) {
            var row = controls[Number(sender.tag)];
            if (row) row.toggle(Number(sender.state) === Number($.NSOnState));
        }},
        'showLog:': {types: ['void', ['id']], implementation: function (sender) {
            var row = controls[Number(sender.tag)];
            if (row) row.reveal();
        }}
    }});
    function label(x, y, w, h, text) {
        var field = $.NSTextField.alloc.mrInitWithXYWidthHeight(x, y, w, h);
        field.stringValue = $(text); field.editable = false; field.selectable = true;
        field.bezeled = false; field.drawsBackground = false; field.cell.wraps = true;
        return field;
    }
    function create(width, makeSession) {
        var id = ++next, delegate = $.MavericksResurrectionDiagnosticControlsDelegate.alloc.init, locked = false;
        var view = $.NSView.alloc.mrInitWithXYWidthHeight(0, 0, width, 92);
        var checkbox = $.NSButton.alloc.mrInitWithXYWidthHeight(0, 62, width - 155, 25);
        checkbox.setButtonType($.NSSwitchButton); checkbox.title = $('Save diagnostic logs');
        checkbox.state = $.NSOffState; checkbox.tag = id; checkbox.target = delegate; checkbox.action = 'toggleLogs:';
        var show = $.NSButton.alloc.mrInitWithXYWidthHeight(width - 145, 59, 145, 30);
        show.title = $('Show log in Finder'); show.bezelStyle = $.NSRoundedBezelStyle;
        show.tag = id; show.target = delegate; show.action = 'showLog:'; show.enabled = false;
        var status = label(3, 0, width - 6, 58, 'Off. Choose a folder to save diagnostic information you can send for troubleshooting.');
        function update(state) {
            checkbox.state = state.enabled ? $.NSOnState : $.NSOffState;
            checkbox.enabled = !state.busy && !state.closed && !locked;
            show.enabled = !!state.path;
            status.stringValue = $(state.enabled ? 'Saving checks, progress, actions and errors to:\n' + state.path :
                state.path ? 'File logging has stopped. Your operation can continue. Saved log:\n' + state.path :
                    'Off. Choose a folder to save diagnostic information you can send for troubleshooting.');
        }
        var session = makeSession(update);
        controls[id] = {toggle: function (enabled) { update(session.setEnabled(enabled)); }, reveal: function () {
            var path = session.state().path;
            if (path) $.NSWorkspace.sharedWorkspace.activateFileViewerSelectingURLs($([$.NSURL.fileURLWithPath($(path))]));
        }};
        [checkbox, show, status].forEach(function (child) { view.addSubview(child); });
        update(session.state());
        return {view: view, session: session, checkbox: checkbox, status: status, delegate: delegate,
            setLocked: function (value) { locked = value === true; update(session.state()); },
            dispose: function () { session.close('application closed'); delete controls[id]; }};
    }
    return {create: create};
}());
