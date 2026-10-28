/* Existing installations: no format approval, size requirement or OS deployment.
 * A separate policy keeps repair selection independent of installation choices. */
var MavericksResurrectionPostUpdateTargets=(function(){
    'use strict';
    var policy=typeof MavericksPolicy!=='undefined'?MavericksPolicy:require('./Policy');
    function reason(info,whole,protectedIDs){
        if(!info||info.WholeDisk!==false||info.PartitionMapPartition!==true||!/^disk[0-9]+s[0-9]+$/.test(info.DeviceIdentifier))return 'Select an existing physical partition.';
        if(!whole||whole.WholeDisk!==true||!/^disk[0-9]+$/.test(whole.DeviceIdentifier)||policy.parentDevice(info)!==whole.DeviceIdentifier||info.DeviceIdentifier.replace(/s[0-9]+$/,'')!==whole.DeviceIdentifier)return 'The physical parent disk could not be verified.';
        if(whole.Virtual===true||whole.VirtualOrPhysical==='Virtual'||whole.BusProtocol==='Disk Image')return 'Disk images and virtual disks are excluded.';
        if(whole.Content!=='GUID_partition_scheme'||info.Content!=='Apple_HFS'||info.Fusion===true||info.RAIDMaster===true||info.RAIDSlice===true)return 'Select a physical Mac OS Extended (Journaled), case-sensitive or non-journaled partition on a GUID disk.';
        if(String(info.FilesystemType||'').toLowerCase()!=='hfs'||info.Encrypted===true||info.FileVault===true)return 'Select an unlocked physical Mac OS Extended installation.';
        // diskutil sets Writable=false on a deliberate read-only mount even
        // while WritableMedia=true. Inspection must keep those two facts apart.
        if(whole.Writable!==true||info.WritableMedia===false||(info.WritableMedia!==true&&info.Writable!==true))return 'The device is not writable.';
        if(whole.Internal!==true&&whole.Internal!==false)return 'The disk location could not be established.';
        if(!Array.isArray(protectedIDs))return 'Protected volumes have not been identified.';
        if(protectedIDs.indexOf(info.DeviceIdentifier)>=0||protectedIDs.indexOf(whole.DeviceIdentifier)>=0||info.MountPoint==='/'||/^\/System(?:\/|$)/.test(info.MountPoint||''))return 'This volume contains the running macOS, app, workspace or diagnostics.';
        var identity=policy.identity(info);if(!policy.unchanged(identity,identity,false))return 'The partition and filesystem identities could not be verified.';
        return '';
    }
    function version(plist,isInstaller){
        if(isInstaller)return null;
        if(!plist||plist.ProductVersion!=='10.9.5'||typeof plist.ProductBuildVersion!=='string'||!/^13F[0-9]+$/.test(plist.ProductBuildVersion))return null;
        return {productVersion:plist.ProductVersion,productBuild:plist.ProductBuildVersion};
    }
    function row(info,whole,os){
        if(!os||!version({ProductVersion:os.productVersion,ProductBuildVersion:os.productBuild},false))throw new Error('A verified Mavericks installation is required.');
        return {identity:policy.identity(info),name:info.VolumeName||'(Unnamed partition)',format:info.FilesystemName||info.FileSystemPersonality||'Mac OS Extended',
            capacity:policy.capacity(info),free:policy.freeSpace(info),location:whole.Internal===true?'Internal':'External',device:'/dev/'+info.DeviceIdentifier,
            productVersion:os.productVersion,productBuild:os.productBuild};
    }
    return {reason:reason,version:version,row:row};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionPostUpdateTargets;
