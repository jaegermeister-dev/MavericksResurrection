/* Sources are created and reused only in this user's managed installer library. */
var MavericksMacSourceDialogs = (function () {
    'use strict';
    ObjC.import('AppKit');
    ObjC.import('Foundation');
    var diagnostic = null, preferredChoice = null;
    function report(event, detail) { try { if (diagnostic) diagnostic(event, detail); } catch (_) {} }
    function panel(title, message, buttons) {
        var value = $.NSClassFromString('MRCompletedAlert').alloc.init;
        value.messageText = $(title); value.informativeText = $(message);
        buttons.forEach(function (text) { value.addButtonWithTitle($(text)); });
        return value;
    }
    function choice() {
        var alert = panel('Choose your Mavericks installer source',
            'Create a new Mavericks image with MavericksForever by Wowfunhappy, or reuse one previously created through MavericksResurrection.',
            ['Continue', 'Cancel']);
        var menu = $.NSPopUpButton.alloc.mrInitWithXYWidthHeightPullsDown(0, 0, 590, 28,false);
        ['Download and build a NEW DMG with MavericksForever',
            'Reuse a DMG previously created through MavericksResurrection'].forEach(function (text) { menu.addItemWithTitle($(text)); });
        alert.accessoryView = menu;
        var selected = Number(alert.runModal) === 1000 ? ['new', 'retained'][Number(menu.indexOfSelectedItem)] : null;
        report('source.choice', {choice: selected}); return selected;
    }
    function savedFolder(create) {
        var path=ObjC.unwrap($.NSHomeDirectory())+'/Library/Application Support/MavericksResurrection/Installers',fm=$.NSFileManager.defaultManager;
        if(create&&!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(path),true,$({NSFilePosixPermissions:448}),null))throw new Error('Cannot create the saved-installer folder.');
        if(!fm.fileExistsAtPath($(path)))return null;
        return ObjC.unwrap($(path).stringByStandardizingPath.stringByResolvingSymlinksInPath);
    }
    function retained(catalog) {
        if (!catalog || !catalog.candidates.length) {
            panel('No retained installer images found',
                'No reusable MavericksResurrection download was found in Application Support. Choose Download and build a new DMG in the main window. Only images created and retained by MavericksResurrection are supported.', ['OK']).runModal;
            return null;
        }
        var alert = panel('Choose a retained MavericksForever image',
            'If this image has a saved checksum, you can choose whether to verify it before reuse.\n' +
                'Keep the original DMG in Application Support with its original name and contents unchanged. This preserves its association with the build record and optional checksum for reliable reuse. You may copy it elsewhere.',
            ['Use selected image', 'Cancel']);
        var menu = $.NSPopUpButton.alloc.mrInitWithXYWidthHeightPullsDown(0, 0, 550, 28,false);
        catalog.candidates.forEach(function (entry) { menu.addItemWithTitle($(entry.path + ' (' + (entry.bytes / 1e9).toFixed(2) + ' GB)')); });
        alert.accessoryView = menu;
        var response=Number(alert.runModal);
        var selected=response===1000?catalog.candidates[Number(menu.indexOfSelectedItem)]:null;
        report('source.retained-chosen', {path: selected?selected.path:null}); return selected;
    }
    // execute is the app's worker runner, which presents progress and returns a result.
    function acquire(execute, initialFolder) {
        var ui={choice:choice,retained:retained,
            savedFolder:function(){
                var paths=[],base=ObjC.unwrap($.NSHomeDirectory())+'/Library/Application Support',fm=$.NSFileManager.defaultManager;
                var entries=ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError($(base),null))||[];
                entries.forEach(function(name){if(!name||name==='.'||name==='..'||name.indexOf('/')>=0)return;var path=base+'/'+name+'/Installers';
                    if(fm.fileExistsAtPath($(path))&&ObjC.unwrap($(path).stringByStandardizingPath.stringByResolvingSymlinksInPath)===path)paths.push(path);});
                return paths;
            },
            workspace:function(route,initial){
                if(route==='new'){
                    var save=Number(panel('Save this DMG for future reuse?',
                        'The DMG is downloaded and built only in ~/Library/Application Support/MavericksResurrection/Installers.\n\nSave and download: keep it after installation for future reuse without another download.\n\nDelete DMG after installation: download and build it here, then delete it once installation completes successfully. If installation fails or is cancelled, keep it for retry.\n\nCancel: go back without downloading.\n\nFor integrity and reliable reuse, leave any retained original in this folder. Do not move, rename or modify it or its build record. You are free to copy it elsewhere.',
                        ['Save and download','Cancel','Delete DMG after installation']).runModal);
                    if(save===1000||save===1002)return {path:savedFolder(true),deleteAfterInstallation:save===1002};
                    return null;
                }
                return {path:savedFolder(true),deleteAfterInstallation:false};},
            hashNew:function(){return Number(panel('Save a checksum for this DMG?','MavericksResurrection can calculate a SHA-256 checksum so you can check whether this DMG has changed before reusing it. This reads the whole DMG and takes additional time.',['Yes, save checksum','No, continue']).runModal)===1000;},
            verifyReuse:function(){return Number(panel('Check the previous download?','Compare this DMG with the SHA-256 checksum saved when it was created. You can skip this check.',['Yes, check checksum','No, continue']).runModal)===1000;},
            mismatch:function(entry,check){var n=Number(panel('This DMG has changed','Its checksum does not match the saved checksum. It may be damaged or modified.\n\nDMG: '+entry.path+'\n\nChoose what to do next. Using it anyway still requires a usable Mavericks installer.',['Use this DMG anyway','Move to Desktop and download again','Delete and download again','Cancel and go back']).runModal);return ['use','move','delete','cancel'][n-1000]||'cancel';}
        };
        var route=preferredChoice;if(route)report('source.choice',{choice:route});
        return MavericksResurrectionSourceAcquisition.acquire(execute,ui,initialFolder,route);
    }

    function maintenanceWorkspace(){
        var path=ObjC.unwrap($.NSHomeDirectory())+'/Library/Application Support/MavericksResurrection/Work',fm=$.NSFileManager.defaultManager;
        if(!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(path),true,$({NSFilePosixPermissions:448}),null))throw new Error('Cannot create the MavericksResurrection working folder.');
        return ObjC.unwrap($(path).stringByStandardizingPath.stringByResolvingSymlinksInPath);
    }
    return {setPreferredChoice:function(value){if(['retained','new',null].indexOf(value)<0)throw new Error('Unknown source choice.');preferredChoice=value;},choice: choice, acquire: acquire, retained: retained, maintenanceWorkspace:maintenanceWorkspace,setDiagnostic: function (callback) { diagnostic = callback; }};
}());
