const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const src=path.resolve(process.argv[2]);
const context={ObjC:{import(){}},Ref(){},$:{}};
vm.runInNewContext(fs.readFileSync(path.join(src,'MacRuntime.js'),'utf8'),context);
const resolve=context.MavericksMacRuntime.volumeForPath;
const mount='/private/var/folders/aa/example/T/AppTranslocation/01234567-89AB-CDEF-0123-456789ABCDEF';
const resource=mount+'/d/MavericksResurrection.app/Contents/Resources';
const source='/Volumes/Project Drive/Downloads/My app on this Mac.app';
const header='Filesystem 512-blocks Used Available Capacity Mounted on\n';
const df=(device,point)=>header+device+' 100000 50000 50000 50% '+point+'\n';
const listing=source+' on '+mount+' (nullfs, local, read-only, mounted by owner)\n';
function probe(mapping,mounts=listing){return (program,args)=>{
 if(program==='/sbin/mount'){assert.deepEqual(Array.from(args),['-t','nullfs']);return {text:mounts};}
 assert.equal(program,'/bin/df');assert.equal(args[0],'-P');
 if(!(args[1] in mapping))throw Error('Unknown or disconnected path');
 return {text:mapping[args[1]]};
};}
assert.equal(resolve('/local',probe({'/local':df('/dev/disk1s1','/System/Volumes/Data')})),'disk1s1');
assert.equal(resolve('/',probe({'/':df('/dev/disk1s4s1','/')})),'disk1s4s1');
const mapping={[resource]:df(source,mount),[source]:df('/dev/disk5s2','/Volumes/Project Drive')};
assert.equal(resolve(resource,probe(mapping)),'disk5s2');
assert.equal(resolve(resource.replace('/private/var/','/var/'),probe({...mapping,[resource.replace('/private/var/','/var/')]:mapping[resource]})),'disk5s2');
// Unknown/mismatched mounts must never silently fall back to the system disk.
assert.throws(()=>resolve(resource,probe(mapping,'')),/Could not identify/);
assert.throws(()=>resolve(resource,probe(mapping,listing.replace('nullfs','apfs'))),/Could not identify/);
assert.throws(()=>resolve(resource,probe(mapping,listing.replace(source,'/other.app'))),/Could not identify/);
assert.throws(()=>resolve(resource,probe({[resource]:mapping[resource]})),/disconnected/);
assert.throws(()=>resolve(resource,probe({...mapping,[source]:mapping[resource]})),/Could not identify/);
assert.throws(()=>resolve('/network',probe({'/network':df('//server/share','/network')})),/Could not identify/);
assert.throws(()=>resolve(resource+'/../not-the-mount',probe({[resource+'/../not-the-mount']:df(source,mount+'-other')})),/Could not identify/);
assert.throws(()=>resolve('/ambiguous',probe({'/ambiguous':df('/dev/disk1s1','/x')+'/dev/disk2s1 100 50 50 50% /y\n'})),/Could not identify/);
assert.throws(()=>resolve('relative',probe({})),/absolute/);
assert.throws(()=>resolve('/bad\npath',probe({})),/absolute/);
console.log(JSON.stringify({passed:true,ordinaryVolumes:true,apfsSnapshots:true,translocatedApps:true,spacesInOriginalPath:true,externalSourceDiskPreserved:true,unresolvedPathsRejected:true}));
