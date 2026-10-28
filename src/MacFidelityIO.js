/* Native-installer fidelity checks, bound to the worker's fresh destination. */
var MavericksResurrectionMacFidelityIO=(function(){
 'use strict';ObjC.import('Foundation');
 function create(stage,validate,hash,resources,progress,diagnostic){
  var fm=$.NSFileManager.defaultManager;
  function read(p){var s=$.NSString.stringWithContentsOfFileEncodingError($(p),$.NSUTF8StringEncoding,null);if(!s||s.isNil())throw new Error('Missing fidelity resource.');return ObjC.unwrap(s);}
  function run(name,catalog){
   validate(stage);
   var tool=resources+'/BundledTools/'+name,asset=JSON.parse(read(resources+'/assets/NativeTools.json')).tools[name];
   var a=fm.attributesOfItemAtPathError($(tool),null);
   if(!asset||!a||a.isNil()||Number(ObjC.unwrap(a.objectForKey($.NSFileSize)))!==asset.bytes||hash(tool)!==asset.sha256)throw new Error('The fidelity helper differs.');
   var root=fm.attributesOfItemAtPathError($(stage.root),null);
   if(!root||root.isNil())throw new Error('The fresh installation is unavailable.');
   var args=[stage.root,String(ObjC.unwrap(root.objectForKey($.NSFileSystemNumber))),String(ObjC.unwrap(root.objectForKey($.NSFileSystemFileNumber))),resources+'/assets/'+catalog];
   var task=$.NSTask.alloc.init,pipe=$.NSPipe.pipe;task.launchPath=$(tool);task.arguments=$(args);
   task.environment=$({PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/root',LANG:'C',LC_ALL:'C'});
   task.standardInput=$.NSFileHandle.fileHandleForReadingAtPath('/dev/null');task.standardOutput=pipe;task.standardError=pipe;
   if(diagnostic)diagnostic('fidelity.command.started',{tool:name});task.launch;
   var data=pipe.fileHandleForReading.readDataToEndOfFile;task.waitUntilExit;
   var value=$.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding),text=value&&!value.isNil()?ObjC.unwrap(value):'(invalid output)';
   if(diagnostic)diagnostic('fidelity.command.finished',{tool:name,status:Number(task.terminationStatus),output:text});
   if(Number(task.terminationStatus))throw new Error('Mavericks installation fidelity check failed: '+text);
   validate(stage);return JSON.parse(text);
  }
  return {
   metadata:function(){progress('Matching Apple’s package receipts and system-folder metadata.',0);var r=run('FidelityMetadata','NativeReceiptACLs.json');if(r.completed!==true||r.packageReceipts!==12||r.aclRecords!==2358)throw new Error('Native metadata preparation is incomplete.');progress('Native receipt and system-folder metadata prepared.',100);return r;},
   sharedCaches:function(runtime){progress('Building Mavericks’ shared-library caches.',0);runtime.run('dyld-caches');progress('Checking the generated Mavericks shared-library caches.',75);var r=run('VerifySharedCaches','NativeSharedCacheInputs.json');if(!r.verified||r.libraries.i386!==282||r.libraries.x86_64!==366)throw new Error('Mavericks library cache selection differs.');progress('Both Mavericks shared-library caches are complete.',100);return r;}
  };
 }
 return {create:create};
}());
