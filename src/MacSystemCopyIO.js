/* Shared copy engine. Destination lifecycle must supply an identity-bound guard. */
var MavericksResurrectionMacSystemCopyIO=(function(){
    'use strict';ObjC.import('Foundation');
    function create(io,destination,resources,bootPreparation,bootAdapter,diagnostic,prepareDestinationBoot) {
        var fm=$.NSFileManager.defaultManager,source=null,sourceGuard=null,dest=destination.current(),destGuard=destination.guard();
        var prepared=null,sourceStat=null,folder=null,selection=null,manifest=null,tools={};
        function report(e,d){try{if(diagnostic)diagnostic(e,d);}catch(_){} }
        function guard(){if(source)sourceGuard(source);if(dest)destGuard(dest);}
        function write(p,s){if(fm.fileExistsAtPath($(p)) || !$(s).writeToFileAtomicallyEncodingError($(p),true,$.NSUTF8StringEncoding,null) || !fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions:384,NSFileOwnerAccountID:0,NSFileGroupOwnerAccountID:0}),$(p),null))throw new Error('Cannot create private copy evidence.');}
        function helper(name){
            if(tools[name])return tools[name];
            var c=JSON.parse(io.readText(resources+'/assets/NativeTools.json')).tools[name],p=resources+'/BundledTools/'+name,s=io.stat(p);
            if(!c || s.kind!=='file' || s.bytes!==c.bytes || io.sha256(p)!==c.sha256)throw new Error('Copy helper differs: '+name);
            tools[name]=p;return p;
        }
        function command(p,args,outPath){
            guard();var t=$.NSTask.alloc.init,pipe=$.NSPipe.pipe,out=outPath?$.NSFileHandle.fileHandleForWritingAtPath($(outPath)):null;
            if(outPath && (!out || out.isNil()))throw new Error('Cannot open copy output.');
            t.launchPath=$(p);t.arguments=$(args);t.environment=$({PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/root',LANG:'C',LC_ALL:'C'});
            t.standardInput=$.NSFileHandle.fileHandleForReadingAtPath('/dev/null');t.standardOutput=out||pipe;t.standardError=pipe;
            report('copy.command.started',{program:p,arguments:args});t.launch;
            var data=pipe.fileHandleForReading.readDataToEndOfFile;t.waitUntilExit;if(out){out.synchronizeFile;out.closeFile;}
            var text=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding));
            report('copy.command.finished',{program:p,status:Number(t.terminationStatus),outputBytes:Number(data.length),output:Number(data.length)<131072?text:null});
            if(Number(t.terminationStatus))throw new Error('Copy command failed: '+text.slice(-8192));guard();return text;
        }
        function sourceUnchanged(){
            if(!source || !sourceStat || JSON.stringify(io.stat(prepared.image.path))!==JSON.stringify(sourceStat))throw new Error('The prepared source image changed during copying.');
            sourceGuard.revalidate();
        }
        return {
            openSource:function(p){
                prepared=p;
                var before=io.stat(p.image.path);
                if(before.kind!=='file' || before.bytes!==p.image.bytes || io.sha256(p.image.path)!==p.image.sha256 || JSON.stringify(before)!==JSON.stringify(io.stat(p.image.path)))throw new Error('The sealed source image changed.');
                sourceStat=before;
                if(io.stat(p.manifest).kind!=='file' || io.sha256(p.manifest)!==p.manifestSHA256)throw new Error('The source filesystem manifest changed.');
                source=io.attach(p.image.path,dest.job,'copyinput',false,true);sourceGuard=io.readOnlyMountGuard(source);sourceUnchanged();
                if(io.stat(source.root).identity.split(':')[0]===io.stat(dest.root).identity.split(':')[0])throw new Error('Copy source and destination are the same filesystem.');
                folder=dest.job+'/copy-verification-'+ObjC.unwrap($.NSUUID.UUID.UUIDString);
                if(!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(folder),false,$({NSFilePosixPermissions:448,NSFileOwnerAccountID:0,NSFileGroupOwnerAccountID:0}),null))throw new Error('Cannot create copy evidence folder.');
            },
            assertEmptyDestination:function(){
                guard();destination.assertEmpty();
                var allowed=['.fseventsd','.Spotlight-V100','.Trashes','.TemporaryItems'];
                if(io.directoryNames(dest.root).some(function(n){return allowed.indexOf(n)<0;}))throw new Error('The destination is not a newly prepared empty filesystem.');
                var fs=fm.attributesOfFileSystemForPathError($(dest.root),null);
                if(!fs || fs.isNil() || Number(ObjC.unwrap(fs.objectForKey($.NSFileSystemFreeSize)))<prepared.audit.logicalFileBytes+1024*1024*1024)throw new Error('The destination does not have enough free space.');
            },
            selectFiles:function(p){
                guard();var list=folder+'/paths.txt';selection=JSON.parse(command(helper('ManifestCompare'),['--copy-list',p.manifest,list]));
                if(selection.manifestSHA256!==p.manifestSHA256 || !Array.isArray(selection.literalSidecars) || selection.literalSidecars.length>1024)throw new Error('Copy list differs from the sealed manifest.');
                selection.literalSidecars.forEach(function(path){
                    if(typeof path!=='string' || /[\x00-\x1f\x7f]/.test(path) || path.split('/').some(function(part){return !part || part==='.' || part==='..';}) || path.split('/').pop().indexOf('._')!==0)throw new Error('Invalid literal metadata file.');
                });
                command('/usr/bin/mkbom',['-s','-i',list,folder+'/copy.bom']);return selection;
            },
            copyFiles:function(){
                guard();io.progress('copy-system','Copying Mavericks files to the prepared destination.');
                command('/usr/bin/ditto',['-X','--rsrc','--extattr','--acl','--qtn','--bom',folder+'/copy.bom',source.root,dest.root]);
                selection.literalSidecars.forEach(function(path){
                    // Each path came from the fully validated sealed manifest.
                    // cp preserves this regular file literally instead of
                    // interpreting its AppleDouble name. Full readback follows.
                    io.regularWithin(source.root,path);
                    var slash=path.lastIndexOf('/'),parent=slash>=0?path.slice(0,slash):'';
                    if(parent)io.directoryWithin(dest.root,parent);
                    if(fm.fileExistsAtPath($(dest.root+'/'+path)))io.regularWithin(dest.root,path);
                    command('/bin/cp',['-p','-P',source.root+'/'+path,dest.root+'/'+path]);
                });
            },
            copyDirectoryMetadata:function(){
                guard();io.progress('copy-metadata','Preserving directory permissions and metadata.');
                return JSON.parse(command(helper('CopyDirectoryMetadata'),[source.root,dest.root]));
            },
            prepareBoot:function(profile){return prepareDestinationBoot?prepareDestinationBoot(dest,destGuard,profile):bootPreparation.prepare(bootAdapter.create(dest,destGuard,io.sha256,diagnostic),profile);},
            verifyCopiedTree:function(){
                guard();dest=destination.readOnly();destGuard=destination.guard();
                manifest=folder+'/copied-filesystem.jsonl';write(manifest,'');
                io.progress('verify-copy','Verifying copied Mavericks files and metadata.');
                command(helper('TreeManifest'),[dest.root],manifest);
                var result=JSON.parse(command(helper('ManifestCompare'),['--installed-system',prepared.manifest,manifest]));
                destGuard.revalidate();return result;
            },
            assertSourceUnchanged:sourceUnchanged,
            close:function(){
                var errors=[];
                if(dest){try{destination.close();dest=null;}catch(e){errors.push(String(e));}}
                if(source){try{io.detach(source);source=null;}catch(e){errors.push(String(e));}}
                if(errors.length)throw new Error(errors.join('\n'));
            },
            record:function(r){write(folder+'/COPY-VERIFIED.json',JSON.stringify({result:r,destination:destination.identity(),destinationManifest:manifest},null,2)+'\n');}
        };
    }
    return {create:create};
}());
