/* Bounded recovery from Spotlight denying a selected-volume operation.
 * No forced unmount, global service control, index erasure or disk-map writes. */
var MavericksResurrectionVolumeRelease=(function(){
    'use strict';
    function spotlight(error){return /\b(?:mds_stores|mds|mdworker|mdworker_shared)\b/.test(String(error));}
    function indexing(text){return /Indexing enabled\./.test(text)?'enabled':(/Indexing disabled\./.test(text)?'disabled':'unavailable');}
    function create(a){
        var leases=[];
        function report(name,detail){if(a.report)a.report(name,detail);}
        function save(){a.record(leases);}
        function fresh(info){var now=a.info('/dev/'+info.DeviceIdentifier);if(!a.same(info,now))throw new Error('The selected volume changed while releasing it.');return now;}
        function restore(lease){
            if(!lease||lease.state==='restored'||lease.state==='reformatted')return;
            var now=fresh(lease.identity);
            if(!now.MountPoint){a.command('/usr/sbin/diskutil',['mount','/dev/'+now.DeviceIdentifier]);now=fresh(lease.identity);}
            if(!now.MountPoint||now.MountPoint==='/')throw new Error('Cannot restore indexing without the same offline volume mounted.');
            a.command('/usr/bin/mdutil',['-i','on',now.MountPoint]);
            if(indexing(a.command('/usr/bin/mdutil',['-s',now.MountPoint]))!=='enabled')throw new Error('Spotlight did not confirm restoration of the original indexing setting.');
            lease.state='restored';save();report('volume.spotlight.restored',{device:now.DeviceIdentifier,name:now.VolumeName});
        }
        function restoreAll(){
            var failures=[];leases.forEach(function(lease){try{restore(lease);}catch(e){failures.push(String(e));}});
            if(failures.length)throw new Error('The operation finished, but restoring Spotlight needs attention: '+failures.join('\n'));
        }
        function recover(info,firstError,operation,erasing){
            if(!spotlight(firstError))throw firstError;
            var now=fresh(info),lease=null;
            if(!now.MountPoint||now.MountPoint==='/'||now.WritableVolume===false)throw firstError;
            try{
                var previous=indexing(a.command('/usr/bin/mdutil',['-s',now.MountPoint]));
                report('volume.spotlight.blocked',{device:now.DeviceIdentifier,name:now.VolumeName,previousIndexing:previous});
                if(previous==='enabled'){
                    lease={identity:JSON.parse(JSON.stringify(info)),originalIndexing:previous,state:'pause-requested'};
                    leases.push(lease);save(); // Durable before changing the setting.
                    a.command('/usr/bin/mdutil',['-i','off',now.MountPoint]);
                    if(indexing(a.command('/usr/bin/mdutil',['-s',now.MountPoint]))!=='disabled')throw new Error('Spotlight did not confirm the temporary pause.');
                    lease.state='paused';save();
                }
                var last=firstError;
                for(var n=0;n<3;n++){
                    a.sleep(n+1);fresh(info);
                    report('volume.spotlight.retry',{device:info.DeviceIdentifier,attempt:n+1,maximum:3});
                    try{
                        var result=operation();
                        if(erasing&&lease){
                            var replacement=a.info('/dev/'+info.DeviceIdentifier);
                            if(a.same(info,replacement))restore(lease);
                            else if(a.samePartition(info,replacement)){lease.state='reformatted';save();}
                            else throw new Error('The selected partition changed during formatting.');
                        }
                        return result;
                    }catch(e){last=e;if(!spotlight(e))throw e;}
                }
                throw new Error('Spotlight is still holding '+(info.VolumeName||info.DeviceIdentifier)+' open after the automatic retry. Close apps using that volume and retry. '+String(last));
            }catch(error){
                try{restore(lease);}catch(cleanup){throw new Error(String(error)+'\n'+String(cleanup));}
                throw error;
            }
        }
        function run(info,operation,erasing){try{return operation();}catch(e){return recover(info,e,operation,!!erasing);}}
        return {run:run,restore:restoreAll,unmount:function(info){return run(info,function(){return a.command('/usr/sbin/diskutil',['unmount','/dev/'+info.DeviceIdentifier]);},false);}};
    }
    function createNative(io,runtime,job,guard,command,policy,diagnostic){
        ObjC.import('Foundation');
        return create({
            info:function(device){guard();return runtime.info(device);},
            same:function(a,b){return policy.unchanged(policy.identity(a),policy.identity(b),false);},
            samePartition:function(a,b){return policy.unchanged(policy.identity(a),policy.identity(b),true);},
            command:command,
            sleep:function(seconds){$.NSThread.sleepForTimeInterval(seconds);},
            report:diagnostic,
            record:function(records){
                guard();var file=job+'/SPOTLIGHT-STATE.json',fm=$.NSFileManager.defaultManager;
                var value=JSON.stringify({schema:1,records:records},null,2)+'\n';
                if(!$(value).writeToFileAtomicallyEncodingError($(file),true,$.NSUTF8StringEncoding,null)||!fm.setAttributesOfItemAtPathError($({NSFilePosixPermissions:384,NSFileOwnerAccountID:0,NSFileGroupOwnerAccountID:0}),$(file),null))throw new Error('Cannot preserve the temporary Spotlight setting.');
            }
        });
    }
    return {create:create,createNative:createNative,isSpotlight:spotlight};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionVolumeRelease;
