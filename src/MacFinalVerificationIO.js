/* Final audit reads a worker-owned image read-only; only evidence is written to
 * its root-owned workspace. It has no physical deployment operation. */
var MavericksResurrectionMacFinalVerificationIO=(function(){
    'use strict';ObjC.import('Foundation');
    function create(sourceIO,resources,bootPreparation,diagnostic,destination) {
        var fm=$.NSFileManager.defaultManager,guards={},current;
        function report(event,detail){try{if(diagnostic)diagnostic(event,detail);}catch(_){} }
        function guard(stage){if(!guards[stage.root])throw new Error('Unowned final verification mount.');guards[stage.root](stage);}
        function path(stage,relative,kind) {
            guard(stage);
            if(!relative || /[\\\x00-\x1f\x7f]/.test(relative) || relative.split('/').some(function(p){return !p || p==='.' || p==='..';}))throw new Error('Invalid final verification path.');
            var full=stage.root,parts=relative.split('/');
            parts.forEach(function(p,i){full+='/'+p;if(sourceIO.stat(full).kind!==(i===parts.length-1?kind:'directory'))throw new Error('Final verification path follows a link or has the wrong type: '+relative);});return full;
        }
        function read(p){return sourceIO.readText(p);}
        function write(p,text) {
            if(fm.fileExistsAtPath($(p)) || !$(text).writeToFileAtomicallyEncodingError($(p),true,$.NSUTF8StringEncoding,null) ||
                !fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions:384,NSFileOwnerAccountID:0,NSFileGroupOwnerAccountID:0}),$(p),null))throw new Error('Cannot save private verification evidence.');
        }
        function command(program,args,outputPath) {
            guard(current);var task=$.NSTask.alloc.init,errors=$.NSPipe.pipe,out=outputPath?$.NSFileHandle.fileHandleForWritingAtPath($(outputPath)):null;
            if(outputPath && (!out || out.isNil()))throw new Error('Cannot open verification output.');
            task.launchPath=$(program);task.arguments=$(args);task.standardInput=$.NSFileHandle.fileHandleForReadingAtPath('/dev/null');
            task.environment=$({PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/root',LANG:'C',LC_ALL:'C'});
            task.standardOutput=out||errors;task.standardError=errors;
            report('verification.command.started',{program:program,arguments:args});task.launch;
            var bytes=errors.fileHandleForReading.readDataToEndOfFile;task.waitUntilExit;
            if(out){out.synchronizeFile;out.closeFile;}
            var text=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes,$.NSUTF8StringEncoding));
            report('verification.command.finished',{program:program,status:Number(task.terminationStatus),outputBytes:Number(bytes.length)});
            if(Number(task.terminationStatus))throw new Error('Final verification failed: '+text.slice(-8192));
            guard(current);return text;
        }
        function helper(name) {
            var catalog=JSON.parse(read(resources+'/assets/NativeTools.json')).tools[name],file=resources+'/BundledTools/'+name,stat=sourceIO.stat(file);
            if(!catalog || stat.kind!=='file' || stat.bytes!==catalog.bytes || sourceIO.sha256(file)!==catalog.sha256)throw new Error('Final verification helper differs.');return file;
        }
        function plist(full) {
            var value=$.NSDictionary.dictionaryWithContentsOfFile($(full));
            if(!value || value.isNil())throw new Error('Cannot read final system property list.');return ObjC.deepUnwrap(value);
        }
        return {
            attachReadOnly:function(receipt){var stage=destination?destination.readOnly():sourceIO.attachVerificationImage(receipt.image,receipt.job);guards[stage.root]=destination?destination.guard():sourceIO.verificationStageGuard(stage);current=stage;return stage;},
            scan:function(stage,plan) {
                guard(stage);var folder=stage.job+'/final-verification-'+ObjC.unwrap($.NSUUID.UUID.UUIDString);
                if(!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(folder),false,$({NSFilePosixPermissions:448,NSFileOwnerAccountID:0,NSFileGroupOwnerAccountID:0}),null))throw new Error('Cannot create final verification folder.');
                var manifest=folder+'/filesystem.jsonl',selection=folder+'/selection.json',inspection=folder+'/inspection.json';
                write(manifest,'');write(selection,JSON.stringify({schema:1,prefixes:plan.prefixes})+'\n');write(inspection,'');
                command(helper('TreeManifest'),[stage.root],manifest);
                command(helper('ManifestCompare'),['--inspect',selection,manifest],inspection);
                var result=JSON.parse(read(inspection));result.path=manifest;
                guards[stage.root].revalidate();return result;
            },
            inspect:function(stage,plan) {
                guard(stage);var version=plist(path(stage,'System/Library/CoreServices/SystemVersion.plist','file'));
                var blessing=command('/usr/sbin/bless',['--info',stage.root,'--plist']);
                var info=$.NSPropertyListSerialization.propertyListWithDataOptionsFormatError($(blessing).dataUsingEncoding($.NSUTF8StringEncoding),0,null,null);
                if(!info || info.isNil())throw new Error('Cannot inspect final boot records.');
                function inode(p){return Number(ObjC.unwrap(fm.attributesOfItemAtPathError($(p),null).objectForKey($.NSFileSystemFileNumber)));}
                bootPreparation.verifyBlessing(ObjC.deepUnwrap(info),stage.root,{
                    folder:inode(path(stage,'System/Library/CoreServices','directory')),file:inode(path(stage,'System/Library/CoreServices/boot.efi','file'))});
                var stamp=sourceIO.stat(path(stage,'System/Library/Caches/com.apple.kext.caches/Startup/kernelcache','file')).modified;
                var newer=['mach_kernel','System/Library/Extensions','Library/Extensions'].every(function(p){return stamp>sourceIO.stat(path(stage,p,p==='mach_kernel'?'file':'directory')).modified;});
                var packages={};plan.packages.forEach(function(p){packages[p.identifier]=plist(path(stage,'private/var/db/receipts/'+p.identifier+'.plist','file'));});
                guards[stage.root].revalidate();
                return {version:{ProductVersion:version.ProductVersion,ProductBuildVersion:version.ProductBuildVersion},
                    bootOptions:plist(path(stage,'Library/Preferences/SystemConfiguration/com.apple.Boot.plist','file')),
                    firstBoot:JSON.parse(read(path(stage,plan.firstBoot.folder+'/State.json','file'))),
                    daemon:plist(path(stage,plan.firstBoot.daemon.path,'file')),notice:plist(path(stage,plan.firstBoot.notice.path,'file')),
                    packages:packages,blessingVerified:true,imageReadOnly:true,cacheNewerThanInputs:newer};
            },
            detach:function(stage){if(destination)destination.close();else sourceIO.detach(stage);delete guards[stage.root];current=null;},
            detachedImageIdentity:function(receipt){return sourceIO.detachedInstalledImageIdentity(receipt.image,receipt.job);}
        };
    }
    return {create:create};
}());
