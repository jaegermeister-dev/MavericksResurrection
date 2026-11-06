const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const src=process.argv[2];
function fixture(options={}){
 const events=[],progress=[],selection=options.selection||'000'; let legacyEnabled=!!options.legacyEnabled;
 const baseAssessment={components:[],alreadyRepaired:true,repairNeeded:false,pending:null};
 const store={location:()=>'/repair',pending:()=>options.repairPending||null,
  recover:()=>{events.push('normal-recover');return {status:'recovered'};},
  assessment:()=>{events.push('audio-assessment');if(options.audioFails)throw Error('audio failed');return {...baseAssessment,components:[],pending:options.repairPending||null};},
  displayAssessment:()=>({matches:true}),applyDisplayProfile:()=>{events.push('display');return {changed:false};}};
 const experiments={pending:()=>options.experimentPending||null,state:()=>({selection}),
  recover:()=>{events.push('graphics-recover');return {status:'recovered'};},
  assessment:s=>{assert.equal(s,'010');events.push('framebuffer-assessment');if(options.unsupported)throw Error('unsupported framebuffer');return {alreadySelected:!!options.matches,components:['Azul']};},
  run:s=>{assert.equal(s,'010');events.push('framebuffer-run');return {status:options.matches?'already-selected':'committed'};}};
 const legacy={pending:()=>options.legacyPending||null,state:()=>({selection:legacyEnabled?'native-112':'original'}),
  assessment:s=>{assert.equal(s,'original');return {components:['AGPM']};},
  recover:()=>{events.push('legacy-recover');return {status:'recovered'};}};
 const guard=()=>{};guard.revalidate=()=>{};
 function load(name){
  if(name==='MacPostUpdateSnapshotIO')return {create:()=>store};
  if(name==='MacExperiments'){events.push('experiments-loaded');return {create:()=>experiments};}
  if(name==='MacGraphicsSnapshotIO'){events.push('legacy-loaded');return {create:()=>legacy};}
  if(name==='MacGraphicsExperiment')return {create:()=>({run:s=>{assert.equal(s,'original');events.push('legacy-restore');legacyEnabled=false;return {status:'committed'};}})};
  throw Error('Unexpected module '+name);
 }
 const context={ObjC:{import:()=>{}},Error};vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(src,'MacPostUpdateRepair.js'),'utf8'),context);
 const api=context.MavericksResurrectionMacPostUpdateRepair.create({},guard,{},'',load,m=>progress.push(m),()=>false,()=>{});
 return {api,events,progress};
}
let f=fixture(),a=f.api.assessment('MacBookPro11,4');assert(a.repairNeeded&&!a.alreadyRepaired&&a.framebufferRepairRequired);
for(const selection of ['000','010','100','110','001','011','101','111']){
 f=fixture({selection});let r=f.api.run('MacBookPro11,4');assert.equal(r.status,'committed');
 assert(f.events.indexOf('framebuffer-run')<f.events.indexOf('audio-assessment'));assert.equal(f.events.at(-1),'display');
}
f=fixture({matches:true});assert(!f.api.assessment('MacBookPro11,4').repairNeeded);assert.equal(f.api.run('MacBookPro11,4').status,'already-repaired');
f=fixture({unsupported:true});assert.throws(()=>f.api.run('MacBookPro11,4'),/unsupported/);assert(!f.events.includes('audio-assessment'));
for(const [option,kind,event] of [['experimentPending','graphics','graphics-recover'],['legacyPending','legacy-graphics','legacy-recover'],['repairPending','normal','normal-recover']]){
 f=fixture({[option]:{id:'pending'}});a=f.api.assessment('MacBookPro11,4');assert.equal(a.pending.kind,kind);assert(!a.alreadyRepaired);
 assert.throws(()=>f.api.run('MacBookPro11,4'),/unfinished post-update/);assert(!f.events.includes('framebuffer-run'));
 assert.equal(f.api.recover('MacBookPro11,4').status,'recovered');assert(f.events.includes(event));
}
f=fixture({experimentPending:{},legacyPending:{}});assert.throws(()=>f.api.recover('MacBookPro11,4'),/More than one/);
assert(!f.events.some(x=>x.endsWith('-recover')));
f=fixture({legacyEnabled:true});a=f.api.assessment('MacBookPro11,4');assert(a.components.includes('AGPM'));
f.api.run('MacBookPro11,4');assert(f.events.indexOf('legacy-restore')<f.events.indexOf('framebuffer-run'));
f=fixture({audioFails:true});assert.throws(()=>f.api.run('MacBookPro11,4'),/framebuffer compatibility was restored, but.*audio failed/);
// 11,5 must not even load a graphics store, including for inspection/recovery.
for(const opts of [{},{experimentPending:{},legacyPending:{},unsupported:true}]){
 f=fixture(opts);assert(!f.api.assessment('MacBookPro11,5').repairNeeded);assert.equal(f.api.run('MacBookPro11,5').status,'already-repaired');
 f.api.recover('MacBookPro11,5');assert(!f.events.includes('experiments-loaded'));assert(!f.events.includes('legacy-loaded'));
}
console.log(JSON.stringify({passed:true,automatic114Support:true,allOldSelectionsUseStandard010:true,repairOrder:true,
 legacyRecoveryAndMigration:true,multipleJournalsFailClosed:true,model115NeverLoads114Engines:true,idempotence:true,partialFailureAccurate:true}));
