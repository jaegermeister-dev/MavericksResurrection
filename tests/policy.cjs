const fs=require('fs'),path=require('path'),assert=require('assert'),vm=require('vm');
const base=process.argv[2];const load=n=>require(path.join(base,'src',n+'.js'));
const cat=JSON.parse(fs.readFileSync(path.join(base,'assets/NVMeCandidates.json'))),pay=JSON.parse(fs.readFileSync(path.join(base,'assets/NVMePayload.json'))),input=JSON.parse(fs.readFileSync(path.join(base,'assets/CacheInputs.json')));
const policy=load('NVMePolicy'),cache=load('CachePreparation'),maint=load('MaintenanceCachePlan'),stage=load('NVMeStage');
assert.equal(cat.candidates.length,1);assert.equal(pay.components.length,1);const hs=policy.candidate(cat,'high-sierra-generic-r1');assert.throws(()=>policy.candidate(cat,'generic-mavericks-r1'));
stage.check(cat,pay);
const target={version:'10.9.5',build:'13F1911',architecture:'x86_64',kernelSHA256:'a'.repeat(64),toolSHA256:'b'.repeat(64),cacheSHA256:'c'.repeat(64)};
const plain=cache.plan('MacBookPro11,5',input,null,cat),plan=cache.plan('MacBookPro11,5',input,hs.id,cat),helper='dev.Jaegermeister.MavericksNVMeCompatibility';
assert.equal(plan.records.length,246);assert(plan.records.some(r=>r.id===helper));
assert.deepEqual(maint.plan(target,plan.records,null).records,plain.records);
const reinstall=maint.plan(target,plain.records,hs);assert.deepEqual(reinstall.records,plan.records);
const repair=load('PostUpdateCachePlan').plan(target,plan.records,'MacBookPro11,5',input.releasedRecords);assert(repair.records.some(r=>r.id===helper));assert(repair.records.some(r=>r.id==='com.apple.iokit.IONVMeFamily'));
let state,calls=[];stage.apply({assertInstalledStage(){},assertAbsentStagePath(s,p){calls.push(p);},prepareNVMePayload(){return {};},installFreshNVMeComponent(){},writeInitialNVMeState(s,r){state=r;return r;}},{},hs.id,cat,pay);
assert.equal(state.payloadArchiveSHA256,pay.archiveSHA256);assert.equal(state.baseline.length,2);assert.equal(state.drivers.length,1);
const p=load('Policy'),rows=load('PartitionViewModel');
const disk={DeviceIdentifier:'disk7',WholeDisk:true,Content:'GUID_partition_scheme',Internal:false,BusProtocol:'USB',Writable:true};
const info={DeviceIdentifier:'disk7s2',ParentWholeDisk:'disk7',WholeDisk:false,PartitionMapPartition:true,Content:'Apple_HFS',FilesystemType:'hfs',FilesystemName:'Mac OS Extended (Journaled)',JournaledHFS:true,Writable:true,WritableMedia:true,DiskUUID:'11111111-1111-1111-1111-111111111111',VolumeUUID:'22222222-2222-2222-2222-222222222222',PartitionMapPartitionOffset:209715200,TotalSize:30e9,VolumeFreeSpace:20e9,MountPoint:'/Volumes/Test',VolumeName:'Test'};
assert.equal(p.targetReason(info,disk,[],'direct'),'');
for(const change of [{MountPoint:undefined,Mounted:false},{FilesystemName:'Mac OS Extended',JournaledHFS:false},{FilesystemName:'Mac OS Extended (Case-sensitive, Journaled)',CaseSensitive:true}]){
 const i={...info,...change};assert(p.targetReason(i,disk,[],'direct'));const list=rows.groups({partitions:[{info:i,whole:disk}],protectedIDs:[]},'direct');assert.equal(list.External.length,1);assert(list.External[0].unavailableReason);
}
assert.equal(rows.groups({partitions:[{info,whole:disk}],protectedIDs:['disk7s2']},'direct').External.length,0);
const compatibility=JSON.parse(fs.readFileSync(path.join(base,'assets/Compatibility.json')));assert(!p.hostApproved('MacBookPro20,1',{model:'MacBookPro20,1',first:true,second:'CONFIRM'},'',compatibility));assert(p.hostApproved('MacBookPro11,5',null,'',compatibility));
for(const name of ['MaintenanceTargets','PostUpdateTargets'])for(const fmt of ['Mac OS Extended','Mac OS Extended (Journaled)','Mac OS Extended (Case-sensitive, Journaled)'])assert.equal(load(name).reason({...info,FilesystemName:fmt,CaseSensitive:fmt.includes('Case')},disk,[]),'');
for(const f of fs.readdirSync(path.join(base,'src')).filter(x=>x.endsWith('.js')))new vm.Script(fs.readFileSync(path.join(base,'src',f),'utf8'),{filename:f});
console.log(JSON.stringify({passed:true,oneDriver:true,cacheInstallRemoveReinstall:true,repairPreservesNVMe:true,legacyAbsentSlotsPreserved:true,HFSListAndMountPolicy:true,modelGate:true,allJavaScriptParses:true}));
