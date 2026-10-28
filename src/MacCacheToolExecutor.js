/* Sandboxed explicit-path prelink/conversion runner for current-install caches. */
var MavericksResurrectionMacCacheToolExecutor=(function(){
    'use strict';ObjC.import('Foundation');
    function create(stage,validate,hash,resources,toolIdentity,diagnostic){
        var helper=resources+'/BundledTools/CacheToolLaunch';
        function read(p){var s=$.NSString.stringWithContentsOfFileEncodingError($(p),$.NSUTF8StringEncoding,null);if(!s||s.isNil())throw new Error('Missing cache launcher catalog.');return ObjC.unwrap(s);}
        var asset=JSON.parse(read(resources+'/assets/NativeTools.json')).tools.CacheToolLaunch;
        if(!asset||!toolIdentity||!/^[a-f0-9]{64}$/.test(toolIdentity.sha256))throw new Error('Current cache tool identity is missing.');
        function report(e,d){try{if(diagnostic)diagnostic(e,d);}catch(_){} }
        return {run:function(args,work){
            validate(stage);
            if(!/^private\/var\/tmp\/MavericksResurrection-Cache-[A-Fa-f0-9-]+$/.test(work)||args[0]!=='-prelinked-kernel'||args[1].indexOf('/'+work+'/')!==0)throw new Error('Unexpected maintained cache output.');
            var name=args[1].slice(work.length+2),operation,ids=[];
            if(args.length===3){operation=args[2]==='-compressed'?'compress':args[2]==='-uncompressed'?'uncompress':null;}
            else{
                operation='prelink';
                if(JSON.stringify(args.slice(2,12))!==JSON.stringify(['-uncompressed','-arch','x86_64','-kernel','/mach_kernel','-volume-root','/','-print-diagnostics','-verbose','3'])||JSON.stringify(args.slice(-3))!==JSON.stringify(['--','/System/Library/Extensions','/Library/Extensions']))throw new Error('Unexpected maintained cache arguments.');
                for(var i=12;i<args.length-3;i+=2){if(args[i]!=='-bundle-id'||typeof args[i+1]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args[i+1]))throw new Error('Unexpected maintained bundle selection.');ids.push(args[i+1]);}
            }
            if(!operation||hash(helper)!==asset.sha256||hash(stage.root+'/usr/sbin/kextcache')!==toolIdentity.sha256)throw new Error('The cache launcher or current tool changed.');
            var root=$.NSFileManager.defaultManager.attributesOfItemAtPathError($(stage.root),null);if(!root||root.isNil())throw new Error('The cache target is unavailable.');
            var command=[stage.root,String(ObjC.unwrap(root.objectForKey($.NSFileSystemNumber))),String(ObjC.unwrap(root.objectForKey($.NSFileSystemFileNumber))),stage.root+'/'+work,toolIdentity.sha256,operation,name].concat(ids);
            var task=$.NSTask.alloc.init,pipe=$.NSPipe.pipe;task.launchPath=$(helper);task.arguments=$(command);task.environment=$({PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/root',LANG:'C',LC_ALL:'C'});
            task.standardInput=$.NSFileHandle.fileHandleForReadingAtPath('/dev/null');task.standardOutput=pipe;task.standardError=pipe;
            report('maintenance.cache-tool.started',{operation:operation,bundles:ids.length,output:name});task.launch;var data=pipe.fileHandleForReading.readDataToEndOfFile;task.waitUntilExit;
            var text=$.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding),message=text&&!text.isNil()?ObjC.unwrap(text):'(non-text cache output)';
            report('maintenance.cache-tool.finished',{status:Number(task.terminationStatus),output:message});validate(stage);
            if(Number(task.terminationStatus)||message.indexOf('GM_CACHE_WRITES_CONFINED\n')<0)throw new Error('Confined Mavericks cache operation failed: '+message.slice(-16000));
            return data;
        }};
    }
    return {create:create};
}());
