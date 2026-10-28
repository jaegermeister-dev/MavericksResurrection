const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const resources=process.argv[2],src=path.join(resources,'src');
const prep=require(path.join(src,'GraphicsCachePreparation.js')),policy=require(path.join(src,'ExperimentsPolicy.js'));
const rows=JSON.parse(fs.readFileSync(path.join(resources,'assets/CacheInputs.json'))).releasedRecords;
const cat=JSON.parse(fs.readFileSync(path.join(resources,'assets/NVMeCandidates.json'))),driver=cat.candidates[0].drivers[0];
const nvme=[{id:driver.bundleID,path:'/'+driver.path},...driver.cacheDependencies.map(r=>({id:r.id,path:r.path}))];
const h='a'.repeat(64),target={version:'10.9.5',build:'13F34',architecture:'x86_64',kernelSHA256:h,toolSHA256:h,cacheSHA256:h};
function fixture(current,opt={}){
 let published=false,commands=[];const out=current.map(r=>({...r,version:'1.0'}));
 const io={assertPrivateStage(){},verifyFile(){},begin(){return 'private/var/tmp/MavericksResurrection-Cache-AA11';},copy(){},runKextcache(a){commands.push(a);},
 prelinkRows(p){return p.endsWith('/inspection')?current:opt.omitNVMe?out.filter(r=>r.id!==driver.bundleID):out;},
 readBundle(p){const r=out.find(r=>r.path===p);return {CFBundleIdentifier:r.id,CFBundleVersion:r.version};},progress(){},verifyGzip(){},sha256(p){return opt.badRoundTrip&&p.endsWith('/roundtrip')?'b'.repeat(64):h;},preservePreviousAlert(){},publish(){published=true;},complete(){}};
 return {io,commands,published:()=>published};
}
for(const r of [rows,rows.concat(nvme)]){
 const f=fixture(r),result=prep.prepare(f.io,target,'MacBookPro11,4',[]);assert(result.completed&&f.published());
 const args=f.commands.find(a=>a.includes('-bundle-id'));for(const x of r)assert.equal(args.filter(a=>a===x.id).length,1);
 assert(args.includes('com.apple.driver.AGPM'));assert(!args.includes('com.apple.driver.AppleGraphicsPowerManagement'));
}
let f=fixture(rows.concat(nvme),{omitNVMe:true});assert.throws(()=>prep.prepare(f.io,target,'MacBookPro11,4',[]),/Required driver is missing/);assert(!f.published());
f=fixture(rows,{badRoundTrip:true});assert.throws(()=>prep.prepare(f.io,target,'MacBookPro11,4',[]),/roundtrip differs/);assert(!f.published());
for(let mask=0;mask<8;mask++){const s=mask.toString(2).padStart(3,'0');assert.equal(policy.encode(policy.decode(s)),s);assert.doesNotThrow(()=>policy.validate(policy.decode(s)));}
assert.throws(()=>policy.decode('1111'));assert.throws(()=>policy.encode(['unknown']));
const future=[{id:'a',conflicts:['b']},{id:'b',conflicts:[]},{id:'c',conflicts:[]}];
assert.deepEqual(policy.conflicts('b',['a'],future),['a']);assert.deepEqual(policy.conflicts('c',['a'],future),[]);
assert.throws(()=>policy.validate(['a','b'],future),/Conflicting/);assert.doesNotThrow(()=>policy.validate(['a','c'],future));assert.deepEqual(policy.conflicts('b',[],future),[]);
console.log(JSON.stringify({passed:true,actualReleased244BundleInventory:true,actualAGPMIdentifier:true,NVMePreserved:true,missingDriverBlocksPublication:true,roundTripFailureBlocksPublication:true,allEightConfigurationsSupported:true,conflictsSymmetricAndValidated:true}));
