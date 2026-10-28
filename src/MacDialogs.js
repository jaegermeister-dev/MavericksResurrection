/* Native AppKit dialogs. Requires the policy/view-model modules in the same JXA context. */
var MavericksMacDialogs = (function () {
    'use strict';
    ObjC.import('AppKit');
    ObjC.import('Foundation');
    var picker = null;
    var diagnostic = null;
    function report(event, detail) { try { if (diagnostic) diagnostic(event, detail); } catch (_) {} }
    function alert(title, message, buttons) {
        var panel = $.NSClassFromString('MRCompletedAlert').alloc.init;
        panel.messageText = $(title);
        panel.informativeText = $(message);
        buttons.forEach(function (label) { panel.addButtonWithTitle($(label)); });
        return panel;
    }
    function startup() {
        var domain='dev.Jaegermeister.MavericksResurrection';
        // A suite matching this app's own bundle identifier is rejected by
        // NSUserDefaults. Use the ordinary application domain in the app;
        // isolated engineering hosts use the explicit named suite.
        var preferences = ObjC.unwrap($.NSBundle.mainBundle.bundleIdentifier)===domain ?
            $.NSUserDefaults.standardUserDefaults : $.NSUserDefaults.alloc.initWithSuiteName(domain);
        if(!preferences||preferences.isNil())throw new Error('MavericksResurrection preferences could not be opened.');
        var notice = MavericksAppPolicy.startupNotice(Boolean(preferences.boolForKey('hideStartupBackupNotice')));
        if (!notice) return true;
        var panel = alert(notice.title, notice.message, notice.actions);
        panel.showsSuppressionButton = true;
        panel.suppressionButton.title = $(notice.checkbox.label);
        panel.suppressionButton.state = $.NSOffState;
        var proceed = Number(panel.runModal) === 1000;
        report('dialog.startup', {proceed: proceed, suppressNextTime: proceed && Number(panel.suppressionButton.state) === Number($.NSOnState)});
        if (!proceed) return false;
        if (Number(panel.suppressionButton.state) === Number($.NSOnState)) {
            preferences.setBoolForKey(true, 'hideStartupBackupNotice');
        }
        return true;
    }
    function approveModel(host,compatibility,maintenance) {
        var profile=MavericksPolicy.profile(host.model,host.board,compatibility);
        var warning=MavericksPolicy.hostWarning(host.model,host.board,compatibility);
        if(profile==='stock') {
            var stock=Number(alert('This Mac officially supports Mavericks',
                'A normal Apple Mavericks installer is recommended for this Mac. You may use this app for an unpatched installation, but support is provided only for MacBookPro11,4 and MacBookPro11,5. If this app does not work on an officially supported Mac, use a normal Mavericks installer.', ['Continue','Cancel']).runModal)===1000;
            return {accepted:stock,profile:profile,approvals:null};
        }
        if(profile==='patched-11,5')return {accepted:true,profile:profile,approvals:null};
        if(profile==='patched-11,4')return {accepted:Number(alert('MacBookPro11,4 is untested',
            'This model receives the shared compatibility fixes and boot changes. MacBookPro11,5-specific graphics and power patches are not applied. Hardware testing has been performed on MacBookPro11,5 only.', ['Continue','Cancel']).runModal)===1000,profile:profile,approvals:null};
        var proceed=Number(alert('The detected Mac is not supported',
            'Detected model: '+host.model+'\n\nYou can continue if the Mac running this app is not the Mac intended for Mavericks. Confirm the actual target model in the next model dialog. If this is the intended Mac, check the detected identifier carefully and correct it only if it is wrong.\n\nThe confirmed target must be MacBookPro11,4, MacBookPro11,5 or an officially Mavericks-compatible Mac. Support is provided only for MacBookPro11,4 and MacBookPro11,5.', ['Continue','Cancel']).runModal)===1000;
        return {accepted:proceed,profile:profile,approvals:proceed?{model:host.model,creationHostOnly:true}:null};
    }
    function chooseInstallModel(host, resolve) {
        var message='Detected on this Mac: '+host.model+'\n\nConfirm the model identifier for your Mavericks installation. Keep the detected value for this Mac, or edit it to choose another model. This determines which compatibility patches are installed. An incorrect model may prevent Mavericks from booting or working properly.';
        var panel=alert('Confirm your Mac model identifier',message,['Continue','Cancel']);
        var input=$.NSTextField.alloc.mrInitWithXYWidthHeight(0,0,420,26);
        input.stringValue=$(host.model);input.placeholderString=$('MacBookPro11,5');
        panel.accessoryView=input;panel.window.initialFirstResponder=input;
        while(Number(panel.runModal)===1000){
            try { var selected=resolve(ObjC.unwrap(input.stringValue));if(selected.compatibilityProfile==='unsupported-stock')throw new Error('This target is unsupported. Enter the actual identifier of MacBookPro11,4, MacBookPro11,5 or an officially Mavericks-compatible Mac.');if(selected.overridden&&Number(alert('Check the target Mac model','You entered '+selected.model+' instead of the detected '+host.model+'. Continue only if this matches the Mac intended to run Mavericks. An incorrect model may prevent it from working and is outside the support scope.',['Continue','Cancel']).runModal)!==1000)return null;report('model.identifier-confirmed',{detected:host.model,selected:selected});return selected; }
            catch(error){panel.informativeText=$(message+'\n\n'+String(error).replace(/^Error: /,''));}
        }
        report('model.identifier-cancelled',{detected:host.model});return null;
    }
    function storageNotice(storage) {
        var result=Number(alert('Internal storage compatibility',MavericksPolicy.storageWarning(storage),['Continue','Cancel']).runModal)===1000;
        report('storage.notice',{storage:storage,accepted:result});return result;
    }
    function driverLabel(catalog,key){if(!key||key==='original')return 'No experimental driver (original state)';var c=MavericksNVMePolicy.candidate(catalog,key);return c.label+' — revision '+c.revision;}
    function maintenanceDetails(target,catalog,current){return MavericksPartitionViewModel.summary(target)+'\nMavericks: '+target.productVersion+' ('+target.productBuild+')\nCurrent driver: '+driverLabel(catalog,current);}
    function chooseExperimentalDriver(catalog,current,target,recommendation) {
        var c=MavericksNVMePolicy.candidate(catalog,'high-sierra-generic-r1');
        if(catalog.candidates.length!==1)throw new Error('The NVMe support catalog is invalid.');
        if(!target)return c.id;
        var message=maintenanceDetails(target,catalog,current)+'\n\n'+c.description+'\n\n'+
            'Install experimental NVMe support and rebuild the boot caches on this Mavericks installation. The volume will not be formatted. You can remove this support later from this macOS install.';
        return Number(alert('Install experimental NVMe support',message,['Install NVMe support','Cancel']).runModal)===1000?c.id:null;
    }
    function setRows() {
        var location = Number(picker.segment.selectedSegment) === 0 ? 'Internal' : 'External';
        picker.rows = picker.groups[location];
        picker.table.reloadData;
        picker.table.deselectAll(null);
        picker.button.enabled = false;
        picker.empty.stringValue = $(picker.rows.length ? '' : picker.emptyText);
    }
    ObjC.registerSubclass({name: 'MavericksPartitionTableDelegate', superclass: 'NSObject',
        protocols: ['NSTableViewDataSource', 'NSTableViewDelegate'], methods: {
            // Let the declared protocols supply their native method signatures.
            'numberOfRowsInTableView:': function () { return picker ? picker.rows.length : 0; },
            'tableView:objectValueForTableColumn:row:': function (table, column, index) {
                if (!picker) return $('');
                var item = picker.rows[Number(index)], key = ObjC.unwrap(column.identifier);
                if (!item) return $('');
                if (key === 'device' && item.mounted === false) return $(item.device+' (unmounted)');
                if (key === 'capacity' || key === 'free') return $(MavericksPolicy.bytes(item[key]));
                return $(item[key]);
            },
            'tableViewSelectionDidChange:': function () {
                if (picker) picker.button.enabled = Number(picker.table.selectedRow) >= 0;
            },
            'locationChanged:': {types: ['void', ['id']], implementation: function () { setRows(); }}
        }});
    function choosePartition(inventory, workflow) {
        var groups = MavericksPartitionViewModel.groups(inventory, workflow);
        if(Number(alert('Prepare and mount your destination first','Before using this app, prepare the intended partition as Mac OS Extended (Journaled), without case sensitivity, and make sure it is mounted in Disk Utility. This helps avoid existing mounting problems that could interrupt installation. All Mac OS Extended variants are listed, including unmounted partitions, but only a mounted Mac OS Extended (Journaled) partition can be used.',['Continue','Cancel']).runModal)!==1000)return null;
        var selected=chooseRows(groups,false);if(selected&&selected.unavailableReason){alert('This partition cannot be used yet','For consistency, this app only uses a partition that is already mounted as Mac OS Extended (Journaled). Please close the app, preferably format the partition in Disk Utility, make sure it is mounted, then reopen the app.\n\n'+selected.unavailableReason,['OK']).runModal;return null;}report('partition.chosen',{workflow:workflow,partition:selected});return selected;
    }
    function chooseMavericks(result,diagnostics){
        var groups={Internal:[],External:[]};
        result.installations.forEach(function(row){if(!groups[row.location])throw new Error('Unknown installation location.');groups[row.location].push(row);});
        if(result.unavailable.length)alert('Some volumes could not be inspected',result.unavailable.map(function(r){return (r.name||r.device)+' ('+r.device+')\n'+r.reason;}).join('\n\n'),['Continue']).runModal;
        var selected=chooseRows(groups,diagnostics?'diagnostics':true);report('maintenance.installation-chosen',{partition:selected,purpose:diagnostics?'collect-diagnostics':'nvme'});return selected;
    }
    function chooseRows(groups,maintenance) {
        var panel = alert(maintenance?'Choose an existing Mavericks installation':'Choose a partition for Mavericks',
            maintenance==='diagnostics'?'Select an existing Mavericks 10.9.5 installation to read its MavericksResurrection first-boot status and any previously enabled first-boot log. The selected installation is not changed. Installer media, the running macOS and app/work/log volumes are excluded.':maintenance?'Select an existing Mavericks 10.9.5 installation on an internal or external partition. Installer media, the running macOS and protected app/work folders are excluded. This action does not format or reinstall Mavericks.':'Select Internal or External to view existing Mac OS Extended partitions. Unmounted or incompatible entries must be prepared in Disk Utility first. The selected partition will be reformatted after three confirmation dialogs.',
            ['Continue', 'Cancel']);
        var view = $.NSView.alloc.mrInitWithXYWidthHeight(0, 0, 760, 395);
        var segment = $.NSSegmentedControl.alloc.mrInitWithXYWidthHeight(0, 358, 250, 28);
        segment.segmentCount = 2;
        segment.setLabelForSegment('Internal', 0); segment.setLabelForSegment('External', 1);
        segment.setWidthForSegment(120, 0); segment.setWidthForSegment(120, 1);
        segment.selectedSegment = groups.Internal.length || !groups.External.length ? 0 : 1;
        var delegate = $.MavericksPartitionTableDelegate.alloc.init;
        segment.target = delegate; segment.action = 'locationChanged:';
        view.addSubview(segment);
        var table = $.NSTableView.alloc.mrInitWithXYWidthHeight(0, 0, 755, 248);
        [['name', 'Partition name', 175], ['format', 'Format', 215], ['capacity', 'Capacity', 95],
         ['free', 'Free space', 95], ['device', 'Device / state', 130]].forEach(function (definition) {
            var column = $.NSTableColumn.alloc.initWithIdentifier($(definition[0]));
            column.headerCell.stringValue = $(definition[1]); column.width = definition[2]; column.editable = false;
            table.addTableColumn(column);
        });
        table.allowsMultipleSelection = false;
        table.usesAlternatingRowBackgroundColors = true;
        table.rowHeight = 25;
        table.delegate = delegate; table.dataSource = delegate;
        var scroll = $.NSScrollView.alloc.mrInitWithXYWidthHeight(0, 97, 760, 248);
        scroll.hasVerticalScroller = true; scroll.borderType = $.NSBezelBorder; scroll.documentView = table;
        view.addSubview(scroll);
        var empty = $.NSTextField.alloc.mrInitWithXYWidthHeight(0, 62, 760, 26);
        empty.stringValue = $(''); empty.editable = false; empty.selectable = true;
        empty.bezeled = false; empty.drawsBackground = false; view.addSubview(empty);
        var help = $.NSTextField.alloc.mrInitWithXYWidthHeight(0, 5, 760, 49);
        help.stringValue = $(maintenance?'Connect the volume containing your installed copy of Mavericks 10.9.5. Installer media and volumes used by this app or its working folder are excluded.':'Prepare the intended partition as Mac OS Extended (Journaled), without case sensitivity, and mount it in Disk Utility before using this app.');
        help.editable = false; help.selectable = true; help.bezeled = false;
        help.drawsBackground = false; help.cell.wraps = true; view.addSubview(help);
        panel.accessoryView = view;
        picker = {groups: groups, rows: [], table: table, segment: segment, empty: empty,
            emptyText:maintenance?'No eligible Mavericks installations in this location.':'No eligible Mac OS Extended (Journaled) partitions in this location.',delegate: delegate, button: panel.buttons.objectAtIndex(0)};
        setRows();
        try {
            var response = Number(panel.runModal);
            var index = Number(table.selectedRow);
            return response === 1000 && index >= 0 ? picker.rows[index] : null;
        } finally { panel.window.orderOut(null); picker = null; }
    }
    function recoverNVMe(target){return Number(alert('Recover the unfinished driver change',MavericksPartitionViewModel.summary(target)+'\n\nThe previous change did not finish. Restore its saved driver and cache state before installing or removing NVMe support.', ['Restore previous state','Cancel']).runModal)===1000;}
    function removeNVMe(target,catalog,current){return Number(alert('Remove experimental NVMe support',maintenanceDetails(target,catalog,current)+'\n\nRemove this app’s experimental storage drivers and rebuild the caches. An internal NVMe installation may stop booting without them. You can return to this macOS to reinstall NVMe support.', ['Remove experimental support','Cancel']).runModal)===1000;}
    function maintained(target,catalog,key){alert('Driver change complete',maintenanceDetails(target,catalog,key)+'\n\nThe driver state and rebuilt caches were verified. Restart when you are ready to test Mavericks. If it does not boot, return to this macOS and collect diagnostics or remove experimental support.', ['Done']).runModal;}
    function confirmFormatting(firstRow, readFreshRow, workflow) {
        // Fresh discovery is required for each dialog and again at the worker boundary.
        var current = readFreshRow(firstRow.identity);
        if (!MavericksPolicy.unchanged(firstRow.identity, current.identity, false)) throw new Error('Partition identity changed. Select the partition again.');
        var first = MavericksPartitionViewModel.firstConfirmation(current,workflow);
        var accepted = Number(alert(first.title, first.details + '\n\n' + first.message, [first.confirmLabel, first.cancelLabel]).runModal) === 1000;
        report('format.confirmation', {step: 1, partition: current, accepted: accepted});
        if (!accepted) return null;
        var secondRow = readFreshRow(current.identity);
        if (!MavericksPolicy.unchanged(current.identity, secondRow.identity, false)) throw new Error('Partition identity changed between confirmations.');
        var second = MavericksPartitionViewModel.secondConfirmation(secondRow,workflow);
        accepted = Number(alert(second.title, second.details + '\n\n' + second.message, [second.confirmLabel, second.cancelLabel]).runModal) === 1000;
        report('format.confirmation', {step: 2, partition: secondRow, accepted: accepted});
        if (!accepted) return null;
        var thirdRow = readFreshRow(secondRow.identity);
        if (!MavericksPolicy.unchanged(secondRow.identity, thirdRow.identity, false)) throw new Error('Partition identity changed between confirmations.');
        var third = MavericksPartitionViewModel.thirdConfirmation(thirdRow,workflow);
        var panel = alert(third.title, third.details + '\n\n' + third.message, [third.confirmLabel, third.cancelLabel]);
        var input = $.NSTextField.alloc.mrInitWithXYWidthHeight(0, 0, 360, 26);
        input.placeholderString = $('CONFIRM'); input.stringValue = $(''); panel.accessoryView = input;
        panel.window.initialFirstResponder = input;
        while (true) {
            if (Number(panel.runModal) !== 1000) { report('format.confirmation', {step: 3, partition: thirdRow, accepted: false}); return null; }
            var answer = ObjC.unwrap(input.stringValue);
            if (MavericksPolicy.confirmed(answer)) {
                var finalRow = readFreshRow(thirdRow.identity);
                if (!MavericksPolicy.unchanged(thirdRow.identity, finalRow.identity, false)) throw new Error('Partition identity changed during the final confirmation.');
                report('format.confirmation', {step: 3, partition: finalRow, accepted: true});
                panel.window.orderOut(null);
                return {first: true, second: true, third: answer, target: finalRow.identity};
            }
            panel.informativeText = $(third.details + '\n\nPlease type CONFIRM. Letter case does not matter.');
        }
    }
    function experimentalOffer(storage, whole) {
        var offer = MavericksNVMePolicy.offer(storage, whole);
        var panel = alert('Experimental NVMe support', offer.message, offer.actions.map(function (action) { return action.label; }));
        // Explicit opt-in; pressing Return alone continues without a driver.
        panel.buttons.objectAtIndex(0).keyEquivalent = $('');
        panel.buttons.objectAtIndex(1).keyEquivalent = $('\r');
        var selected = Number(panel.runModal) === 1000 ? 'choose-driver' : 'not-now';
        report('nvme.offer', {offer: offer, choice: selected}); return selected;
    }
    return {alert: alert, startup: startup, approveModel:approveModel, storageNotice:storageNotice, chooseExperimentalDriver:chooseExperimentalDriver,
        choosePartition: choosePartition, chooseInstallModel:chooseInstallModel,
        chooseMavericks:chooseMavericks,recoverNVMe:recoverNVMe,removeNVMe:removeNVMe,maintained:maintained,
        confirmFormatting: confirmFormatting, experimentalOffer: experimentalOffer,
        setDiagnostic: function (callback) { diagnostic = callback; }};
}());
