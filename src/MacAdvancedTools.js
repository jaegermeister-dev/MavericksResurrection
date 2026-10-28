var MavericksResurrectionMacAdvancedTools=(function(){
 'use strict';ObjC.import('Foundation');ObjC.import('AppKit');
 function create(resources,session,m,window){
  function modal(a){try{return Number(a.runModal);}finally{a.window.orderOut(null);}}
  function tell(title,text){modal(m.dialogs.alert(title,text,['OK']));}
  function confirm(title,text,button){return modal(m.dialogs.alert(title,text,[button||'Continue','Cancel']))===1000;}
  function choose(title,text,rows,label){
   if(!rows.length){tell(title,'No eligible entries were found.');return null;}
   var a=m.dialogs.alert(title,text,['Continue','Cancel']),p=$.NSPopUpButton.alloc.mrInitWithXYWidthHeightPullsDown(0,0,590,30,false);
   rows.forEach(function(r){p.addItemWithTitle($(label(r)));});a.accessoryView=p;
   return modal(a)===1000?rows[Number(p.indexOfSelectedItem)]:null;
  }
  function diskLabel(i){return (i.Internal?'Internal':'External / image')+' | '+(i.VolumeName||'EFI')+' | '+i.DeviceIdentifier+' | '+(Number(i.TotalSize||i.IOKitSize)/1073741824).toFixed(1)+' GiB | '+(i.MountPoint?'mounted':'unmounted');}
  function shell(s){return "'"+String(s).replace(/'/g,"'\\''")+"'";}
  function apple(s){return '"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r')+'"';}
  var launcher={stage:function(r,request,events,errors){
   if(request.action.indexOf('advanced-')!==0)throw Error('Unknown advanced action.');
   var graphics=request.action.indexOf('advanced-graphics-')===0;
   var args=graphics?['/usr/bin/osascript','-l','JavaScript',r+'/src/GraphicsWorker.js',r,JSON.stringify(request)]:['/usr/bin/ruby',r+'/src/AdvancedWorker.rb',ObjC.unwrap($.NSUserName()),JSON.stringify(request)];
   return {executable:'/usr/bin/osascript',arguments:['-e','do shell script '+apple(args.map(shell).join(' ')+' > '+shell(events)+' 2> '+shell(errors))+' with administrator privileges']};
  }};
  function execute(request){return m.runner.prepareSystem(resources,request,session.logger,launcher);}
  function inventory(){return execute({action:'advanced-inventory'});}
  function selectedTarget(inv){return choose('Select the Mavericks installation','All HFS+ variants are listed, including unmounted partitions. Select the installation you want to investigate. These tools never format it. Its OS version is checked when readable.',inv.targets,diskLabel);}
  function selectedEFI(inv){return choose('Select the EFI partition for this test','The tool and all of its EFI logs will be stored on this partition. It can be on a different disk from Mavericks. Existing OpenCore and boot files are preserved.',inv.efis,diskLabel);}
  function saved(result){
   var extra=result.summary&&result.summary.operation_error?'\n\nCollection was incomplete: '+result.summary.operation_error:'';
   var a=m.dialogs.alert('Diagnostic files saved','Saved to:\n'+result.path+extra+'\n\nReports can contain hardware identifiers, usernames and file paths. Review them before sharing. Nothing was uploaded.',['Show in Finder','Done']);
   if(modal(a)===1000)$.NSWorkspace.sharedWorkspace.selectFileInFileViewerRootedAtPath($(result.path),$(''));
  }
  function readonly(){
   var t=selectedTarget(inventory());if(!t)return;
   if(!confirm('Collect read-only diagnostics',diskLabel(t)+'\n\nThe selected partition will be normally unmounted, inspected read-only, checked with filesystem repairs disabled, and left unmounted. A normal unmount can flush writes already pending in macOS. No patches or repairs are applied.\n\nA report ZIP will be saved to your Desktop. This can take several minutes.','Collect report'))return;
   saved(execute({action:'advanced-readonly',target:t,confirmed:true}));
  }
  function prepare(){
   if(!confirm('OpenCore and OpenShell are required','Use your existing OpenCore EFI if installed. Otherwise install OpenCore EFI separately using OCLP; you can use it for these tests even if your current macOS does not need it.\n\nMavericksResurrection does not install or configure OpenCore. OpenShell must be available from its boot picker. The generated instructions explain how to locate this tool.\n\nThe EFI offers diagnostics-only and a separate boot attempt. Booting Mavericks can write to disks. Preserve a damaged installation before further boot tests.'))return;
   var inv=inventory(),t=selectedTarget(inv);if(!t)return;var e=selectedEFI(inv);if(!e)return;
   if(!confirm('Prepare the EFI diagnostic tool','Mavericks: '+diskLabel(t)+'\nEFI/logs: '+diskLabel(e)+'\n\nNew files will go in a unique folder under EFI/MavericksResurrection-Diagnostics. Existing boot files and OpenCore settings are preserved. Mavericks is only read to identify its loader.','Prepare tool'))return;
   saved(execute({action:'advanced-prepare',target:t,efi:e,confirmed:true}));
  }
  function collect(){
   var e=selectedEFI(inventory());if(!e)return;
   var cases=execute({action:'advanced-cases',efi:e}).cases;
   var name=choose('Select the EFI test case','Choose the case you prepared for this Mavericks installation.',cases,function(s){return s;});if(!name)return;
   var a=m.dialogs.alert('What happened during the test?','Describe whether Mavericks reached the desktop, the last screen, HDMI/dock connections, and whether NVMe support was installed. You can leave this blank and send the details separately.',['Collect report','Cancel']);
   var input=$.NSTextField.alloc.mrInitWithXYWidthHeight(0,0,590,26);a.accessoryView=input;
   if(modal(a)!==1000)return;
   saved(execute({action:'advanced-collect',efi:e,case:name,observation:ObjC.unwrap(input.stringValue)}));
  }
  function graphics(){
   var discovered=session.discoverRepairTargets(),t=m.dialogs.chooseMavericks(discovered,false);if(!t)return;
   var inv=session.inventory([]),model=session.chooseRepairModel(inv);if(!model)return;
   if(model!=='MacBookPro11,4'){tell('MacBookPro11,4 only','These experiments are only for a confirmed MacBookPro11,4 installation. They do not apply to MacBookPro11,5 or other models.');return;}
   var workspace=m.sourceDialogs.maintenanceWorkspace();
   function request(action,selection){return execute({action:action,selection:selection||'000',target:t,model:model,confirmed:true,workspace:workspace,protectedPaths:[resources,workspace],protectedIDs:session.logger.protectedVolumeIDs()});}
   var inspected=request('advanced-graphics-inspect');
   if(inspected.pending){
    var legacy=inspected.pending.legacy;
    if(confirm(legacy?'Restore the previous graphics setting':'Recover unfinished experimental changes',t.name+' — '+t.device+'\n\n'+(legacy?'Restore the previous Beta 5 graphics transaction before using these settings.':'A previous change did not finish. Restore its saved files and caches before changing any settings.'),'Restore saved state')){request('advanced-graphics-recover');tell('Previous state restored','Reopen Debug and select this installation to change its experimental settings.');}return;
   }
   var code=$.NSString.stringWithContentsOfFileEncodingError($(resources+'/src/ExperimentsPolicy.js'),$.NSUTF8StringEncoding,null);
   if(!code||code.isNil())throw Error('Experimental settings are unavailable.');
   var policy=Function(ObjC.unwrap(code)+'\nreturn MavericksResurrectionExperimentsPolicy;')();
   var current=policy.decode(inspected.assessment.currentSelection);policy.validate(current);
   var a=m.dialogs.alert('MacBookPro11,4 experimental settings',t.name+' — '+t.device+'\n\nThese settings apply only to this Mavericks installation. Checked options were read from its saved configuration and verified against its files.\n\nAll three current options can be combined. Try one change at a time so the result is clear. They are untested on 11,4 hardware and may not resolve a boot failure.',['Apply to this installation','Cancel']);
   var panel=$.NSView.alloc.mrInitWithXYWidthHeight(0,0,590,304),boxes=[],notes=[];
   function label(y,h,text){var v=$.NSTextField.alloc.mrInitWithXYWidthHeight(22,y,566,h);v.stringValue=$(text);v.editable=false;v.selectable=false;v.bezeled=false;v.drawsBackground=false;v.cell.wraps=true;v.font=$.NSFont.systemFontOfSize(11);panel.addSubview(v);return v;}
   function selected(){return policy.definitions.filter(function(d,i){return Number(boxes[i].state)===1;}).map(function(d){return d.id;});}
   function refresh(){var choices=selected();policy.definitions.forEach(function(d,i){var other=policy.conflicts(d.id,choices);boxes[i].enabled=Number(boxes[i].state)===1||other.length===0;notes[i].stringValue=$(d.description+(other.length?' Uncheck '+other.map(function(id){return policy.definitions.filter(function(x){return x.id===id;})[0].title;}).join(', ')+' to use this option.':''));});}
   var className='MavericksResurrectionExperimentChecks'+ObjC.unwrap($.NSUUID.UUID.UUIDString).replace(/-/g,'');
   ObjC.registerSubclass({name:className,superclass:'NSObject',methods:{'changed:':{types:['void',['id']],implementation:function(){refresh();}}}});
   var delegate=$.NSClassFromString(className).alloc.init;
   policy.definitions.forEach(function(d,i){var y=270-i*86,b=$.NSButton.alloc.mrInitWithXYWidthHeight(0,y,590,26);b.setButtonType($.NSSwitchButton);b.title=$(d.title);b.state=current.indexOf(d.id)>=0?1:0;b.target=delegate;b.action='changed:';panel.addSubview(b);boxes.push(b);notes.push(label(y-50,49,d.description));});
   label(0,43,'Untick an option to restore its saved original files. Changes are saved on this installation, so reopening the app or selecting a different disk shows that installation’s settings.');
   refresh();a.accessoryView=panel;if(modal(a)!==1000)return;
   var selection=policy.encode(selected());
   if(selection===inspected.assessment.currentSelection){tell('No change needed','This installation already has the selected settings.');return;}
   request('advanced-graphics-apply',selection);
   var verified=request('advanced-graphics-inspect');
   if(verified.pending||verified.assessment.currentSelection!==selection)throw Error('Experimental configuration could not be confirmed. Reopen Debug to inspect or recover it.');
   tell('Experimental settings applied','The selected files and rebuilt caches were verified on '+t.name+'.\n\nBoot Mavericks to test the result. Return here and select the same installation to disable or change its experiments without reinstalling. This does not confirm hardware compatibility.');
  }

  return {open:function(){
   var action=choose('Debug — Advanced users only','These tools help investigate boot failures. These optional MacBookPro11,4 experiments are untested and may not help. Normal installation settings are unchanged unless you explicitly apply them.',[
    {name:'Collect read-only filesystem and installation diagnostics',run:readonly},{name:'Prepare the EFI diagnostic / boot tool',run:prepare},{name:'Collect EFI reports',run:collect},{name:'MacBookPro11,4 experimental settings',run:graphics}
   ],function(a){return a.name;});if(action)action.run();
  }};
 }
 return {create:create};
}());
