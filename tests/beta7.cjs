const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const res=process.argv[2],src=path.join(res,'src'),load=n=>require(path.join(src,n+'.js'));
const cat=JSON.parse(fs.readFileSync(path.join(res,'assets/ModelPayload.json'))),target='System/Library/Displays/Overrides/DisplayVendorID-610/DisplayProductID-a02f';
load('ModelPatches').catalogCheck(cat);
for(const [model,board] of [['MacBookPro11,4','Mac-06F11FD93F0323C5'],['MacBookPro11,5','Mac-06F11F11946D27C5']]){
 const writes=[];const r=load('ModelPatches').apply({assertInstalledStage(){},prepareModelPayload(){return {};},progress(){},replaceModelComponent(s,p,c){writes.push(c.target);}}, {},model,board,cat);
 assert.equal(writes.filter(x=>x===target).length,1);assert.deepEqual(r.components,writes);
}
assert.equal(load('PatchPlan').plan('MacBookPro11,3','Mac-2BD1B31983FE1663','direct').installedPaths.length,0);
const flow=load('ApplicationFlow');for(const [v,ok] of [['10.15.7',false],['11.0',true],['11.7.11',true],['12.7.6',true],['26.7.1',true]])assert.equal(flow.supportedHost(v),ok);
const text=fs.readFileSync(path.join(src,'MacProgressView.js'),'utf8');assert(text.indexOf('text.layoutManager;')<text.indexOf('scroll.documentView=text;'));
const transport=fs.readFileSync(path.join(src,'MacUpdateTransport.js'),'utf8');assert(!transport.includes("protocols:['NSURLConnectionDataDelegate']"));
const repair=fs.readFileSync(path.join(src,'MacPostUpdateRepair.js'),'utf8');assert(repair.includes('displayProfile=d;return a;'));assert(repair.includes('store.applyDisplayProfile()'));
console.log(JSON.stringify({passed:true,displayProfileFresh114and115:true,stock113Unchanged:true,BigSurHostGate:true,TextKit1Preserved:true,updaterNoMissingProtocol:true,repairIncludesDisplayAssessment:true}));
