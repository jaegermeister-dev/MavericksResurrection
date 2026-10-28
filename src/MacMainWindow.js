/* Yosemite-compatible native main window with an integrated task and live log. */
var MavericksResurrectionMacMainWindow=(function(){
    'use strict';ObjC.import('Foundation');ObjC.import('AppKit');
    var current=null,layout=MavericksResurrectionMainWindowLayout;
    ObjC.registerSubclass({name:'MavericksResurrectionMainWindowDelegate',superclass:'NSObject',protocols:['NSWindowDelegate'],methods:{
        'startDirect:':{types:['void',['id']],implementation:function(){if(current)current.perform('direct');}},
        'changeDriver:':{types:['void',['id']],implementation:function(){if(current)current.perform('nvme');}},
        'removeDriver:':{types:['void',['id']],implementation:function(){if(current)current.perform('removeNVMe');}},
        'repairUpdates:':{types:['void',['id']],implementation:function(){if(current)current.perform('repair');}},
        'collectDiagnostics:':{types:['void',['id']],implementation:function(){if(current)current.perform('collectDiagnostics');}},
        'showAdvanced:':{types:['void',['id']],implementation:function(){if(current)current.perform('advanced');}},
        'showLogging:':{types:['void',['id']],implementation:function(){if(current)current.logging();}},
        'cancelOperation:':{types:['void',['id']],implementation:function(){if(current)current.cancel();}},
        'showCredits:':{types:['void',['id']],implementation:function(){if(current)current.credits();}},
        'showSupport:':{types:['void',['id']],implementation:function(){if(current)current.support();}},
        'requestQuit:':{types:['void',['id']],implementation:function(){if(current)current.requestClose();}},
        'windowShouldClose:':function(){return current?current.canClose():true;},
        'windowDidResize:':function(){if(current)current.resize();},
        'windowWillClose:':function(){if(current){current.saveSize();current.closed=true;}}
    }});
    function label(x,y,w,h,text,size,bold){
        var v=$.NSTextField.alloc.mrInitWithXYWidthHeight(x,y,w,h);v.stringValue=$(text);v.editable=false;v.selectable=true;
        v.bezeled=false;v.drawsBackground=false;v.cell.wraps=true;v.font=bold?$.NSFont.boldSystemFontOfSize(size):$.NSFont.systemFontOfSize(size);return v;
    }
    function create(resources,session,dialogs,capabilities,handlers,progressView,sourceDialogs){
        if(current)throw new Error('The main window is already open.');
        var app=$.NSApplication.sharedApplication,delegate=$.MavericksResurrectionMainWindowDelegate.alloc.init;
        var w=$.NSWindow.alloc.mrInitWithXYWidthHeightStyleMaskBackingDefer(0,0,layout.initial.width,layout.initial.height,$.NSTitledWindowMask|$.NSClosableWindowMask|$.NSMiniaturizableWindowMask|$.NSResizableWindowMask,$.NSBackingStoreBuffered,false);
        w.title=$('MavericksResurrection');w.releasedWhenClosed=false;w.delegate=delegate;
        w.mrSetContentMinSizeWithWidthHeight(layout.minimum.width,layout.minimum.height);
        var preferences=$.NSUserDefaults.standardUserDefaults,screen={width:Number($.NSScreen.mainScreen.mrVisibleWidth),height:Number($.NSScreen.mainScreen.mrVisibleHeight)};
        var restored=layout.restoredSize({width:Number(preferences.doubleForKey('mainWindowWidth')),height:Number(preferences.doubleForKey('mainWindowHeight'))},
            {width:Number(screen.width),height:Number(screen.height)});
        w.mrSetContentSizeWithWidthHeight(restored.width,restored.height);
        w.contentView=$.NSClassFromString('MavericksResurrectionWindowCanvas').alloc.mrInitWithXYWidthHeight(0,0,restored.width,restored.height);
        var buttons=[],busy=false,cancelCallback=null,controls={};
        function add(v){w.contentView.addSubview(v);return v;}
        function button(x,y,width,title,action,enabled){
            var b=$.NSButton.alloc.mrInitWithXYWidthHeight(x,y,width,33);b.title=$(title);b.bezelStyle=$.NSRoundedBezelStyle;
            b.target=delegate;b.action=action;b.enabled=!!enabled;buttons.push({view:b,available:!!enabled});return add(b);
        }
        controls.heading=add(label(26,620,760,28,'Install OS X Mavericks',20,true));
        controls.subtitle=add(label(27,590,762,26,'Original MavericksForever script by Wowfunhappy.\nMavericksResurrection and its bundled script maintained by Jaegermeister-dev.',11,false));
        controls.sourceLabel=add(label(27,559,762,22,'Installer source',13,true));
        var sourceMenu=$.NSPopUpButton.alloc.mrInitWithXYWidthHeightPullsDown(24,526,769,30,false);
        ['Download and build a new DMG with MavericksForever','Reuse a DMG previously created through MavericksResurrection'].forEach(function(s){sourceMenu.addItemWithTitle($(s));});add(sourceMenu);
        controls.source=sourceMenu;
        controls.changeDriver=button(22,479,396,'Install experimental NVMe support','changeDriver:',capabilities.nvme);
        controls.removeDriver=button(423,479,373,'Remove experimental NVMe support','removeDriver:',capabilities.nvme);
        controls.repair=button(22,440,272,'Fix post-update issues','repairUpdates:',true);
        controls.diagnostics=button(309,440,487,'Collect installation diagnostics…','collectDiagnostics:',true);
        controls.debug=button(22,401,774,'Debug — Advanced users only…','showAdvanced:',true);
        progressView.view.mrSetFrameOriginWithXY(27,105);add(progressView.view);
        controls.help=add(label(27,64,768,32,'Only an existing Mac OS Extended (Journaled) partition can be selected. Three confirmations are required before it is formatted.',12,false));
        controls.support=add(label(27,4,768,14,'MavericksResurrection issues: contact Jaegermeister-dev. Wowfunhappy does not maintain this app.',10,false));
        controls.logging=button(22,20,160,'Diagnostic logs…','showLogging:',true);
        controls.credits=button(187,20,88,'Support…','showSupport:',true);
        var cancelButton=button(465,20,112,'Cancel','cancelOperation:',false);
        controls.cancel=cancelButton;
        controls.install=button(587,20,209,'Install Mavericks…','startDirect:',capabilities.direct);
        controls.changeDriver.font=$.NSFont.systemFontOfSize(11);
        controls.removeDriver.font=$.NSFont.systemFontOfSize(11);
        function resize(){
            var size={width:Number(w.contentView.mrBoundsWidth),height:Number(w.contentView.mrBoundsHeight)},frames=layout.frames(Math.max(layout.minimum.width,Number(size.width)),Math.max(layout.minimum.height,Number(size.height)));
            Object.keys(controls).forEach(function(key){var f=frames[key];controls[key].mrSetFrameWithXYWidthHeight(f[0],f[1],f[2],f[3]);});
            var p=frames.progress;progressView.resize(p[2],p[3]);progressView.view.mrSetFrameOriginWithXY(p[0],p[1]);
        }
        resize();
        var status=progressView.status;
        function tell(title,message){dialogs.alert(title,message,['OK']).runModal;}
        function canClose(){if(busy){tell('An operation is running','Use Cancel, then wait for the current operation to finish before quitting.');return false;}return true;}
        function menu(){
            var bar=$.NSMenu.alloc.initWithTitle($('Main menu')),item=$.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($('MavericksResurrection'),null,$(''));
            var submenu=$.NSMenu.alloc.initWithTitle($('MavericksResurrection'));
            var credits=$.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($('About MavericksResurrection'),'showCredits:',$(''));credits.target=delegate;submenu.addItem(credits);
            submenu.addItem($.NSMenuItem.separatorItem);
            var quit=$.NSMenuItem.alloc.initWithTitleActionKeyEquivalent($('Quit MavericksResurrection'),'requestQuit:',$('q'));quit.target=delegate;submenu.addItem(quit);
            item.submenu=submenu;bar.addItem(item);app.mainMenu=bar;
        }
        current={window:w,delegate:delegate,closed:false,buttons:buttons,statusField:status,resize:resize,
            saveSize:function(){var size={width:Number(w.contentView.mrBoundsWidth),height:Number(w.contentView.mrBoundsHeight)};preferences.setDoubleForKey(Number(size.width),'mainWindowWidth');preferences.setDoubleForKey(Number(size.height),'mainWindowHeight');preferences.synchronize;},
            status:function(s){progressView.message(s);w.displayIfNeeded;app.updateWindows;},
            logging:function(){var a=dialogs.alert('Diagnostic logs','Optionally save a detailed log to a folder for troubleshooting. The activity log remains visible without saving a file.',['Done']);a.accessoryView=session.diagnostics.view;a.runModal;},
            cancel:function(){if(cancelCallback)cancelCallback();},
            presentation:{begin:function(request,cancel){cancelCallback=cancel;cancelButton.enabled=true;progressView.begin(request);},event:progressView.event,
                stopping:function(message){cancelButton.enabled=false;progressView.stopping(message);},finish:function(success){cancelButton.enabled=false;cancelCallback=null;progressView.finish(success);}},
            canClose:canClose,requestClose:function(){if(canClose())w.close;},
            support:function(){
                var file=$.NSString.stringWithContentsOfFileEncodingError($(resources+'/assets/SupportLinks.json'),$.NSUTF8StringEncoding,null);
                if(!file||file.isNil())throw new Error('Support links are unavailable.');
                var links=JSON.parse(ObjC.unwrap(file));
                var a=dialogs.alert('MavericksResurrection support',
                    'Report MavericksResurrection issues to Jaegermeister-dev through the project links below.\n\nWowfunhappy created the original MavericksForever script. They did not create MavericksResurrection and do not maintain this app or its bundled adaptation. Please do not send MavericksResurrection issues to them.\n\n'+(links.reddit?'':'The Reddit community is coming soon.'),
                    ['GitHub','Reddit'+(links.reddit?'':' (coming soon)'),'Credits','Close']);
                a.buttons.objectAtIndex(1).enabled=!!links.reddit;
                var answer=Number(a.runModal),url=answer===1000?links.github:answer===1001?links.reddit:null;
                if(answer===1002){current.credits();return;}
                if(url){
                    if(!/^https:\/\/(github\.com|www\.reddit\.com|reddit\.com)\//.test(url))throw new Error('Invalid support link.');
                    if(!$.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString($(url))))tell('Could not open the support page',url);
                }
            },
            credits:function(){tell('MavericksResurrection — 1.0 Beta 6','The original MavericksForever script was created by Wowfunhappy (mavericksforever.com).\n\nMavericksResurrection and its bundled adaptation of that script are maintained by Jaegermeister-dev.\n\nReport MavericksResurrection issues to Jaegermeister-dev, not Wowfunhappy. Wowfunhappy did not create MavericksResurrection and does not maintain this app or its bundled adaptation.\n\nSupport is provided only for MacBookPro11,4 / 11,5. Officially Mavericks-compatible Macs can also use this app without model patches, but are outside its support scope. macOS Monterey 12 or later required; tested on Monterey. macOS and OS X are Apple software.\n\nMacBookPro11,4 support is untested. NVMe compatibility with other SSD models remains experimental.');},
            perform:function(action){
                if(busy)return;
                if(!handlers[action]){tell('Feature unavailable','This action is unavailable. Please reopen the application.');return;}
                if(action==='direct')sourceDialogs.setPreferredChoice(['new','retained'][Number(sourceMenu.indexOfSelectedItem)]);
                busy=true;sourceMenu.enabled=false;buttons.forEach(function(b){b.view.enabled=false;});session.diagnostics.setLocked(true);
                try{handlers[action]();}catch(e){current.status('The operation did not complete.');progressView.append(String(e));session.logger.record('application.action.failed',{action:action,message:String(e)});tell('Operation did not complete',String(e));}
                finally{busy=false;sourceMenu.enabled=true;buttons.forEach(function(b){b.view.enabled=b.available;});session.diagnostics.setLocked(false);}
            },
            installed:function(partition,result){
                var cleanup=result&&result.sourceCleanup,note='';
                if(cleanup)note=cleanup.completed?'\n\nThe installer DMG was deleted as requested.':'\n\nMavericks installation succeeded, but the installer DMG could not be deleted. Check the file in Application Support:\n'+cleanup.path;
                if(cleanup&&cleanup.message)note+='\n'+cleanup.message;
                tell('Mavericks files installed and verified','Partition: '+partition.name+'\nDevice: '+partition.device+'\n\nRestart when you are ready, hold Option (Alt), and choose that Mavericks partition. Initial setup will finish during the first boot.\n\nDisconnect HDMI from the laptop before booting Mavericks. Keep this macOS install available for diagnostics, NVMe maintenance and post-update repair.'+note);
            },
            diagnosticsCollected:function(partition,result){
                var files=result.collection.files.map(function(f){return f.name;}),message='Partition: '+partition.name+'\nDevice: '+partition.device+'\n\n';
                if(result.export.saved){
                    message+=files.length?'Collected: '+files.join(', ')+'.':'No MavericksResurrection first-boot files were present on this installation.';
                    message+='\n\nFirst-boot output is available only if diagnostic logging was enabled when this app prepared the installation.\n\nSend this diagnostic log for troubleshooting:\n'+result.export.path;
                }else message+='The diagnostic log could not be fully saved. Choose another diagnostic folder and collect again.';
                tell(result.export.saved?'Installation diagnostics saved':'Diagnostic log incomplete',message);
            },
            run:function(){menu();w.center;w.makeKeyAndOrderFront(null);app.activateIgnoringOtherApps(true);
                while(!current.closed){var e=app.nextEventMatchingMaskUntilDateInModeDequeue($.NSAnyEventMask,$.NSDate.dateWithTimeIntervalSinceNow(0.1),$.NSDefaultRunLoopMode,true);if(e && !e.isNil())app.sendEvent(e);app.updateWindows;}
                session.close();current=null;
            }
        };
        return current;
    }
    return {create:create};
}());
