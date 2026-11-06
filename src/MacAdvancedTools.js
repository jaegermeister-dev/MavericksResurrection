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
   var args=['/usr/bin/ruby',r+'/src/AdvancedWorker.rb',ObjC.unwrap($.NSUserName()),JSON.stringify(request)];
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
  return {open:function(){
   var action=choose('Debug — Advanced users only','Collect installation diagnostics, prepare an EFI diagnostic tool, or collect its saved reports. These tools do not apply graphics patches.',[
    {name:'Collect read-only filesystem and installation diagnostics',run:readonly},{name:'Prepare the EFI diagnostic / boot tool',run:prepare},{name:'Collect EFI reports',run:collect}
   ],function(a){return a.name;});if(action)action.run();
  }};
 }
 return {create:create};
}());
