/* Notification-only update UI; preferences belong to the running app's user. */
var MavericksResurrectionMacUpdateChecker=(function(){
 'use strict';ObjC.import('Foundation');ObjC.import('AppKit');
 var policy=MavericksResurrectionUpdatePolicy;
 function preferences(defaults){
  return {
   enabled:function(){var v=defaults.objectForKey('updateChecksEnabled');return !v||v.isNil()?true:Boolean(defaults.boolForKey('updateChecksEnabled'));},
   setEnabled:function(value){defaults.setBoolForKey(!!value,'updateChecksEnabled');defaults.synchronize;},
   skipped:function(){var v=defaults.stringForKey('skippedUpdateVersion');return !v||v.isNil()?'':ObjC.unwrap(v);},
   skip:function(tag){defaults.setObjectForKey($(tag),'skippedUpdateVersion');defaults.synchronize;}
  };
 }
 function create(identity,dialogs,transport,options){
  options=options||{};var store=options.store||preferences($.NSUserDefaults.standardUserDefaults),started=false,stopped=false,pending=null;
  var openURL=options.openURL||function(url){return Boolean($.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString($(url))));};
  function report(event,detail){try{if(options.record)options.record(event,detail);}catch(_){}}
  function modal(a){try{return Number(a.runModal);}finally{a.window.orderOut(null);}}
  function checkbox(title,state){var b=$.NSButton.alloc.mrInitWithXYWidthHeight(0,0,620,38);b.setButtonType($.NSSwitchButton);b.title=$(title);b.cell.wraps=true;b.font=$.NSFont.systemFontOfSize(11);b.state=state?1:0;return b;}
  function start(){if(started||stopped||!store.enabled())return;started=true;transport.start();}
  function notice(release){
   var a=dialogs.alert('A new version of MavericksResurrection is available','You are using '+identity.releaseLabel+'.\nThe latest version is '+release.label+'.\n\nDownload opens this version\'s GitHub release page in your browser.',['Download','Not now',"Don't remind me about this version"]);
   var b=checkbox("Don't inform me of new versions again (This can be changed in Preferences)",false);a.accessoryView=b;
   var choice=modal(a);if([1000,1001,1002].indexOf(choice)<0)return;
   if(Number(b.state)===1)store.setEnabled(false);
   if(choice===1002)store.skip(release.tag);
   if(choice===1000&&!openURL(release.url))modal(dialogs.alert('Could not open the release page',release.url,['OK']));
  }
  return {
   start:start,
   poll:function(idle){
    if(stopped)return;
    try{
     if(!store.enabled()){pending=null;if(started)transport.cancel();started=false;return;}
     var result=transport.takeResult();
     if(result){if(result.ok)pending=policy.available(result.record,identity.releaseLabel,store.skipped());else report('updates.check.unavailable',{reason:result.reason,status:result.status||null});}
     if(pending&&idle){var release=pending;pending=null;notice(release);}
    }catch(_){pending=null;report('updates.check.unavailable',{reason:'invalid-response'});}
   },
   preferences:function(){
    var a=dialogs.alert('Preferences','Check GitHub for new versions when the app opens. Updates are never downloaded or installed by MavericksResurrection.',['Save','Cancel']);
    var b=checkbox('Check for updates when MavericksResurrection opens',store.enabled());a.accessoryView=b;
    if(modal(a)!==1000)return;
    store.setEnabled(Number(b.state)===1);
    if(!store.enabled()){pending=null;if(started)transport.cancel();started=false;}else start();
   },
   stop:function(){stopped=true;pending=null;transport.cancel();}
  };
 }
 return {create:create,preferences:preferences};
}());
