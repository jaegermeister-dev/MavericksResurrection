/* Discover and exclusively mount an existing offline Mavericks installation.
 * No format, partition-map, cache, driver or user-file mutation commands exist
 * here. Discovery inspects mounted volumes in place; otherwise it uses a temporary
 * read-only mount. Only the selected maintenance target is remounted writable. */
var MavericksResurrectionMacMaintenanceIO=(function(){
    'use strict';ObjC.import('Foundation');
    function create(io,runtime,resources,job,protectedPaths,retainedIDs,targets,policy,diagnostic){
        if(ObjC.unwrap($.NSUserName())!=='root')throw new Error('Administrator access is required to inspect offline installations.');
        var fm=$.NSFileManager.defaultManager,jobIdentity=io.stat(job).identity,paths=[resources,job].concat(protectedPaths||[]),remembered=(retainedIDs||[]).slice(),current=null;
        function canonical(path){return ObjC.unwrap($(path).stringByStandardizingPath.stringByResolvingSymlinksInPath);}
        function jobGuard(){var s=io.stat(job);if(s.kind!=='directory'||s.uid!==0||s.mode!==448||s.identity!==jobIdentity||canonical(job)!==job)throw new Error('The private maintenance workspace changed.');}
        function report(e,d){try{if(diagnostic)diagnostic(e,d);}catch(_){} }
        function command(tool,args){
            jobGuard();if(!((tool==='/usr/sbin/diskutil'&&['mount','unmount'].indexOf(args[0])>=0)||(tool==='/usr/bin/mdutil'&&((args.length===2&&args[0]==='-s')||(args.length===3&&args[0]==='-i'&&['on','off'].indexOf(args[1])>=0)))||tool==='/sbin/mount_hfs'||(tool==='/sbin/mount'&&args.length===0)))throw new Error('Unsupported maintenance mount command.');
            var task=$.NSTask.alloc.init,pipe=$.NSPipe.pipe;task.launchPath=$(tool);task.arguments=$(args);
            task.environment=$({PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:'/var/root',LANG:'C',LC_ALL:'C'});
            task.standardInput=$.NSFileHandle.fileHandleForReadingAtPath('/dev/null');task.standardOutput=pipe;task.standardError=pipe;
            report('maintenance.mount.started',{program:tool,arguments:args});task.launch;var data=pipe.fileHandleForReading.readDataToEndOfFile;task.waitUntilExit;
            var message=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding)),status=Number(task.terminationStatus);
            report('maintenance.mount.finished',{program:tool,status:status,output:message});if(status)throw new Error('Cannot open or close this Mavericks volume: '+message);jobGuard();return message;
        }
        var releaseSource=$.NSString.stringWithContentsOfFileEncodingError($(resources+'/src/VolumeRelease.js'),$.NSUTF8StringEncoding,null);
        if(!releaseSource||releaseSource.isNil())throw new Error('Missing volume-release support.');
        var release=Function(ObjC.unwrap(releaseSource)+'\nreturn MavericksResurrectionVolumeRelease;')().createNative(io,runtime,job,jobGuard,command,policy,report);
        function protections(){var ids=remembered.slice(),host=runtime.info('/').DeviceIdentifier;if(ids.indexOf(host)<0)ids.push(host);paths.forEach(function(p){var id=runtime.volumeForPath(p);if(ids.indexOf(id)<0)ids.push(id);});return ids;}
        function snapshot(identity){
            jobGuard();if(!identity||!policy.unchanged(identity,identity,false))throw new Error('Invalid selected partition identity.');
            var info=runtime.info('/dev/'+identity.bsd),whole=runtime.info('/dev/'+identity.parent),blocked=targets.reason(info,whole,protections());if(blocked)throw new Error(blocked);
            if(!policy.unchanged(identity,policy.identity(info),false))throw new Error('The selected partition or volume changed.');
            var images=runtime.plist('/usr/bin/hdiutil',['info','-plist']);if(!images||!Array.isArray(images.images))throw new Error('Cannot verify the attached disk-image inventory.');
            images.images.forEach(function(image){(image['system-entities']||[]).forEach(function(e){if(String(e['dev-entry']||'').replace(/s[0-9]+$/,'')==='/dev/'+identity.parent)throw new Error('Disk images are not maintenance targets.');});});
            var list=runtime.plist('/usr/sbin/diskutil',['list','-plist','/dev/'+identity.parent]);
            if(!list||!Array.isArray(list.AllDisksAndPartitions)||list.AllDisksAndPartitions.length!==1||list.AllDisksAndPartitions[0].DeviceIdentifier!==identity.parent||!Array.isArray(list.AllDisksAndPartitions[0].Partitions))throw new Error('The disk layout could not be verified.');
            var found=0,layout=list.AllDisksAndPartitions[0].Partitions.map(function(p){
                if(!/^disk[0-9]+s[0-9]+$/.test(p.DeviceIdentifier)||p.DeviceIdentifier.replace(/s[0-9]+$/,'')!==identity.parent)throw new Error('Unexpected disk-map entry.');
                var detail=p.DeviceIdentifier===identity.bsd?info:runtime.info('/dev/'+p.DeviceIdentifier);if(p.DeviceIdentifier===identity.bsd)found++;
                return {bsd:detail.DeviceIdentifier,partitionUUID:detail.DiskUUID||'',volumeUUID:detail.VolumeUUID||'',offset:detail.PartitionMapPartitionOffset,capacity:policy.capacity(detail),content:detail.Content};
            });if(found!==1)throw new Error('The selected partition disappeared from its disk map.');
            return {info:info,whole:whole,layout:layout,parent:{bsd:whole.DeviceIdentifier,capacity:policy.capacity(whole),content:whole.Content,internal:whole.Internal,protocol:whole.BusProtocol,media:whole.MediaName||'',tree:whole.DeviceTreePath||'',uuid:whole.DiskUUID||''}};
        }
        function same(a,b){if(!policy.unchanged(policy.identity(a.info),policy.identity(b.info),false)||JSON.stringify(a.layout)!==JSON.stringify(b.layout)||JSON.stringify(a.parent)!==JSON.stringify(b.parent))throw new Error('The selected disk or a sibling partition changed.');}
        function path(root,relative,kind,optional){
            var at=root,parts=relative.split('/');for(var i=0;i<parts.length;i++){at+='/'+parts[i];
                if(optional&&!fm.fileExistsAtPath($(at))){var parent=at.slice(0,at.lastIndexOf('/')),names=fm.contentsOfDirectoryAtPathError($(parent),null);if(!names||names.isNil())throw new Error('Cannot inspect installation metadata.');if(ObjC.deepUnwrap(names).indexOf(parts[i])<0)return null;}
                var s=io.stat(at);if(s.kind!==(i===parts.length-1?kind:'directory'))throw new Error('Linked or unexpected installation metadata.');
            }return at;
        }
        function installed(root){
            if(!root||root==='/'||canonical(root)!==root||io.stat(root).kind!=='directory')throw new Error('Invalid offline installation mount.');
            var file=path(root,'System/Library/CoreServices/SystemVersion.plist','file',true);if(!file)return null;
            if(path(root,'System/Installation/CDIS','directory',true))return null;
            var s=io.stat(file);if(s.bytes>65536)return null;
            var plist=$.NSDictionary.dictionaryWithContentsOfFile($(file));if(!plist||plist.isNil())return null;
            return targets.version(ObjC.deepUnwrap(plist),false);
        }
        function displayInfo(root,info){
            var result=JSON.parse(JSON.stringify(info));
            if(policy.freeSpace(result)===null){var values=fm.attributesOfFileSystemForPathError($(root),null);
                if(values&&!values.isNil()){var value=values.objectForKey($.NSFileSystemFreeSize);if(value&&!value.isNil()){var free=Number(ObjC.unwrap(value));if(isFinite(free)&&free>=0&&free<=policy.capacity(result))result.VolumeFreeSpace=free;}}
            }return result;
        }
        function newMountpoint(){var name=job+'/maintenance-'+ObjC.unwrap($.NSUUID.UUID.UUIDString);if(!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(name),false,$({NSFilePosixPermissions:448,NSFileOwnerAccountID:0,NSFileGroupOwnerAccountID:0}),null))throw new Error('Cannot create a private mountpoint.');return name;}
        function checkMount(record, full){
            jobGuard();if(record.stage.root!==record.mountpoint||record.stage.job!==job||record.stage.device!=='/dev/'+record.binding.info.DeviceIdentifier)throw new Error('The owned mount description changed.');
            // Recheck the selected mount without rescanning unrelated siblings.
            // Complete layout checks remain at acquisition and release.
            var fresh=full?snapshot(policy.identity(record.binding.info)):{info:runtime.info(record.stage.device)};
            if(full)same(record.binding,fresh);
            else if(!policy.unchanged(policy.identity(record.binding.info),policy.identity(fresh.info),false))throw new Error('The selected partition or volume changed.');
            if(fresh.info.MountPoint!==record.stage.root||io.stat(record.stage.root).identity!==record.rootIdentity||fresh.info.GlobalPermissionsEnabled!==true||fresh.info.WritableVolume!==record.stage.writable)throw new Error('The offline volume mount or ownership changed.');
            var prefix=record.stage.device+' on '+record.stage.root+' (',lines=command('/sbin/mount',[]).split('\n').filter(function(line){return line.indexOf(prefix)===0&&line.slice(-1)===')';});
            if(lines.length!==1)throw new Error('Cannot verify the offline volume mount flags.');var flags=lines[0].slice(prefix.length,-1).split(', ');
            if(flags.indexOf('nosuid')<0||flags.indexOf('nodev')<0||flags.indexOf('nobrowse')<0||(flags.indexOf('read-only')<0)!==record.stage.writable)throw new Error('Offline mount restrictions changed.');
            return fresh;
        }
        function attach(binding,writable){
            var fresh=snapshot(policy.identity(binding.info));same(binding,fresh);if(fresh.info.MountPoint||fresh.info.Mounted===true)throw new Error('This volume is already mounted elsewhere.');
            var mountpoint=newMountpoint();command('/sbin/mount_hfs',['-o',(writable?'':'rdonly,')+'nobrowse,owners,nosuid,nodev','/dev/'+binding.info.DeviceIdentifier,mountpoint]);
            var record={binding:binding,mountpoint:mountpoint,stage:{root:mountpoint,job:job,device:'/dev/'+binding.info.DeviceIdentifier,writable:writable,enforceOwners:true},rootIdentity:io.stat(mountpoint).identity};
            try{checkMount(record);}catch(e){var info=runtime.info(record.stage.device);if(info.MountPoint===mountpoint&&io.stat(mountpoint).identity===record.rootIdentity)command('/usr/sbin/diskutil',['unmount',record.stage.device]);throw e;}return record;
        }
        function detach(record){var info=checkMount(record,true).info;release.unmount(info);}
        function discover(inventory){
            jobGuard();if(current)throw new Error('Close the current maintenance operation before scanning.');var rows=[],unavailable=[];
            inventory.partitions.forEach(function(item){if(targets.reason(item.info,item.whole,inventory.protectedIDs))return;
                var identity=policy.identity(item.info),record=null;
                try{
                    var before=snapshot(identity),os,details;
                    if(before.info.MountPoint){var root=before.info.MountPoint,rootID=io.stat(root).identity;os=installed(root);var after=runtime.info('/dev/'+identity.bsd);if(!policy.unchanged(identity,policy.identity(after),false)||after.MountPoint!==root||io.stat(root).identity!==rootID)throw new Error('The inspected volume changed.');details=displayInfo(root,after);}
                    else{record=attach(before,false);os=installed(record.stage.root);var observed=checkMount(record);details=displayInfo(record.stage.root,observed.info);}
                    if(os)rows.push(targets.row(details,before.whole,os));
                }catch(e){unavailable.push({device:'/dev/'+identity.bsd,name:item.info.VolumeName||'',reason:String(e)});}
                finally{if(record)detach(record);}
            });
            return {installations:rows,unavailable:unavailable};
        }
        function open(selected){
            jobGuard();if(current)throw new Error('A maintenance volume is already open.');
            var before=snapshot(selected.identity),wasMounted=!!before.info.MountPoint;
            // An unmounted filesystem also reports WritableVolume=false. Its
            // media writability was verified separately; verify the new mount.
            if(wasMounted&&before.info.WritableVolume===false)throw new Error('The selected installation is mounted read-only.');
            if(wasMounted)release.unmount(before.info);
            try{
                current=attach(before,true);var os=installed(current.stage.root);
                if(!os||os.productVersion!==selected.productVersion||os.productBuild!==selected.productBuild)throw new Error('The selected Mavericks installation changed since it was listed.');
            }catch(e){
                var cleanup=[];
                try{if(current){detach(current);current=null;}if(wasMounted){same(before,snapshot(selected.identity));command('/usr/sbin/diskutil',['mount','/dev/'+before.info.DeviceIdentifier]);}}catch(c){cleanup.push(String(c));}
                try{release.restore();}catch(c){cleanup.push(String(c));}
                throw new Error(String(e)+(cleanup.length?'\n'+cleanup.join('\n'):''));
            }
            var bound=current;
            function guard(stage){jobGuard();if(current!==bound||stage!==bound.stage||stage.root!==bound.mountpoint||stage.job!==job||stage.device!=='/dev/'+before.info.DeviceIdentifier||io.stat(stage.root).identity!==bound.rootIdentity||stage.root==='/'||stage.writable!==true||stage.enforceOwners!==true)throw new Error('The maintenance target identity changed.');}
            guard.revalidate=function(){guard(bound.stage);checkMount(bound);};
            return {stage:bound.stage,guard:guard,identity:selected.identity,version:{productVersion:selected.productVersion,productBuild:selected.productBuild},close:function(){
                if(current!==bound)throw new Error('The maintenance volume is no longer owned by this operation.');
                var failures=[];
                try{detach(bound);current=null;if(wasMounted){same(before,snapshot(selected.identity));command('/usr/sbin/diskutil',['mount','/dev/'+before.info.DeviceIdentifier]);same(before,snapshot(selected.identity));}}catch(e){failures.push(String(e));}
                try{release.restore();}catch(e){failures.push(String(e));}
                if(failures.length)throw new Error(failures.join('\n'));
            }};
        }
        function readSelected(selected,reader){
            jobGuard();if(current)throw new Error('Close maintenance before collecting diagnostics.');
            var before=snapshot(selected.identity),record=null,root=before.info.MountPoint,rootID,stage;
            try{
                if(!root){record=attach(before,false);root=record.stage.root;}
                rootID=io.stat(root).identity;
                stage=record?record.stage:{root:root,job:job,device:'/dev/'+selected.identity.bsd,writable:false,enforceOwners:false};
                function guard(given){jobGuard();if(given!==stage||stage.root!==root||stage.job!==job||stage.device!=='/dev/'+selected.identity.bsd||io.stat(root).identity!==rootID)throw new Error('The diagnostic source changed.');}
                guard.revalidate=function(){guard(stage);if(record){checkMount(record);return;}var fresh=runtime.info(stage.device);if(!policy.unchanged(selected.identity,policy.identity(fresh),false)||fresh.MountPoint!==root)throw new Error('The diagnostic volume was remounted.');};
                guard.revalidate();var os=installed(root);
                if(!os||os.productVersion!==selected.productVersion||os.productBuild!==selected.productBuild)throw new Error('The selected Mavericks installation changed.');
                var result=reader(stage,guard);guard.revalidate();return result;
            }finally{if(record)detach(record);}
        }
        jobGuard();return {discover:discover,open:open,readSelected:readSelected};
    }
    return {create:create};
}());
