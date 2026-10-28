/* Final read-only system audit and detached image seal. This verifies prepared
 * inputs for later copy/verification; it does not establish a successful boot. */
var MavericksResurrectionFinalVerification = (function () {
    'use strict';
    var first='Library/Application Support/MavericksResurrection/FirstBoot';
    var nvmeSlots=['System/Library/Extensions/IONVMeFamily.kext','System/Library/Extensions/NVMeGeneric.kext'];
    var boot='System/Library/CoreServices',cache='System/Library/Caches/com.apple.kext.caches/Startup/';
    function sha(s) { return typeof s==='string' && /^[a-f0-9]{64}$/.test(s); }
    function same(a,b) {
        if (Array.isArray(a)) return Array.isArray(b) && a.length===b.length && a.every(function(v,i){return same(v,b[i]);});
        if (a && typeof a==='object') return b && typeof b==='object' && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(function(k){return same(a[k],b[k]);});
        return a===b;
    }
    function plan(receipt,catalogs,patchPlan,firstBootPlan) {
        var r=receipt,s=r && r.offlineSetup;
        if (!r || r.kind!=='mavericks-packages-staged' || r.version!=='10.9.5' || r.build!=='13F34' ||
            r.verified!==false || !same(r.requiredNextPhases,['final-verification']) || !s || !s.completed ||
            !r.modelPatches || !r.nvme || !r.caches || !r.boot || !r.cleanup ||
            r.modelPatches.kind!=='mavericks-model-patches' || r.nvme.kind!=='mavericks-initial-nvme' ||
            r.caches.kind!=='mavericks-cache-preparation' || r.boot.kind!=='mavericks-boot-preparation' || r.cleanup.kind!=='mavericks-stage-cleanup' ||
            !r.modelPatches.completed || !r.nvme.completed || !r.caches.completed || !r.boot.completed || !r.cleanup.completed ||
            r.caches.profile!==r.modelPatches.profile || r.boot.profile!==r.modelPatches.profile ||
            r.caches.candidate!==r.nvme.candidate || r.boot.startupDiskChanged!==false || r.cleanup.criticalFilesUnchanged!==true ||
            !r.firstBoot || !r.firstBoot.configured || r.firstBoot.runConfirmed!==false || r.nativeInitializationConfirmed!==false) throw new Error('All private-image preparation phases must complete before final verification.');
        var profile=r.modelPatches.profile,board={'MacBookPro11,4':'Mac-06F11FD93F0323C5','MacBookPro11,5':'Mac-06F11F11946D27C5'}[profile];
        if (['stock','MacBookPro11,4','MacBookPro11,5'].indexOf(profile)<0) throw new Error('Unknown prepared model profile.');
        var selected=patchPlan.plan(profile,board,'direct').installedPaths;
        if (!same(r.modelPatches.components,selected.map(function(c){return c.target;}))) throw new Error('Prepared model components differ.');
        var components=selected.map(function(c){
            var found=catalogs.model.components.filter(function(e){return e.source===c.source && e.target===c.target;});
            if(found.length!==1)throw new Error('Missing model component inventory.');return found[0];
        });
        var selectedNVMe=[];
        if(r.nvme.candidate!==null) {
            var candidates=catalogs.candidates.candidates.filter(function(c){return c.id===r.nvme.candidate && c.payloadVerified;});
            if(candidates.length!==1)throw new Error('Unknown selected NVMe driver.');
            selectedNVMe=candidates[0].drivers.map(function(d){return d.path;});
            selectedNVMe.forEach(function(p){
                var found=catalogs.nvme.components.filter(function(c){return c.target===p;});
                if(found.length!==1)throw new Error('Missing NVMe component inventory.');components.push(found[0]);
            });
        }
        if(!same(r.nvme.drivers,selectedNVMe))throw new Error('Prepared NVMe components differ.');
        var expected=[];
        function file(p,hash,bytes,mode) {
            if(!sha(hash))throw new Error('Missing prepared file identity: '+p);
            var e={path:p,kind:'file',sha256:hash,uid:0,gid:0};
            if(bytes!==undefined)e.bytes=bytes;if(mode!==undefined)e.mode=mode;expected.push(e);
        }
        file('mach_kernel',catalogs.cache.kernelSHA256);
        file('usr/sbin/kextcache',catalogs.cache.tool.sha256,catalogs.cache.tool.bytes);
        [boot+'/boot.efi','usr/standalone/i386/boot.efi'].forEach(function(p){file(p,'72f3225ff8efadc607086b5778a328918a7fffbb763cad682b0bb29ed31a4795',505400,420);});
        file(cache+'kernelcache',r.caches.kernelcacheSHA256);
        var info=[cache+'IOKitPersonalities_x86_64.ioplist.gz',cache+'KextPropertyValues_OSBundleHelper_x86_64.plist.gz'];
        if(!same(Object.keys(r.caches.informationCaches).sort(),info.slice().sort()))throw new Error('Prepared information caches differ.');
        info.forEach(function(p){file(p,r.caches.informationCaches[p]);});
        file(first+'/FirstBootSetup',catalogs.tools.tools.FirstBootSetup.sha256,catalogs.tools.tools.FirstBootSetup.bytes,493);
        catalogs.firstBoot.files.forEach(function(e){expected.push(e);});
        if(!r.offlineSetup.nativeMetadata || r.offlineSetup.nativeMetadata.completed!==true || r.offlineSetup.nativeMetadata.packageReceipts!==12 || !r.offlineSetup.sharedCaches || r.offlineSetup.sharedCaches.verified!==true)throw new Error('Native metadata/shared-cache preparation is incomplete.');
        ['i386','x86_64'].forEach(function(arch){
            expected.push({path:'private/var/db/dyld/dyld_shared_cache_'+arch,kind:'file',mode:420,uid:0,gid:0});
            expected.push({path:'private/var/db/dyld/dyld_shared_cache_'+arch+'.map',kind:'file',mode:420,uid:0,gid:0});
        });
        var packages=catalogs.packages.packages.filter(function(p){return p.name!=='OSInstall.pkg';});
        if(packages.length!==12 || !Array.isArray(r.installedPackages) || r.installedPackages.length!==13 ||
            !catalogs.packages.packages.every(function(p){return r.installedPackages.filter(function(i){return i.identifier===p.identifier && i.version===p.version && i.receiptExpected===(p.name!=='OSInstall.pkg');}).length===1;}))throw new Error('Prepared Apple package receipts differ.');
        packages.forEach(function(p){file('private/var/db/receipts/'+p.identifier+'.bom',p.members.Bom.sha256,p.members.Bom.bytes);});
        var absent=['.PKInstallSandboxManager','System/Library/Caches/com.apple.kernelcaches','private/var/db/.AppleSetupDone',
            'System/Installation/CDIS','System/Installation/Packages','post-install-patches.sh','Library/LaunchDaemons/com.apple.install.osinstallersetupd.plist'];
        absent=absent.concat(nvmeSlots.filter(function(p){return selectedNVMe.indexOf(p)<0;}));
        if(r.nvme.candidate===null)absent.push('Library/Application Support/MavericksResurrection/NVMe');
        else file('Library/Application Support/MavericksResurrection/NVMe/initial-state.json',r.nvme.state.sha256,undefined,384);
        var empty=['private/tmp','private/var/tmp','dev','Volumes'];
        var plists=[boot+'/SystemVersion.plist','Library/Preferences/SystemConfiguration/com.apple.Boot.plist'];
        var state=firstBootPlan.plan(r.firstBoot.installID,r.firstBoot.diagnosticsRequested===true,catalogs.firstBoot);
        plists.push(state.daemon.path,state.notice.path);
        [first+'/State.json',state.daemon.path,state.notice.path].forEach(function(p){expected.push({path:p,kind:'file',mode:420,uid:0,gid:0});});
        expected.push({path:first,kind:'directory',mode:493,uid:0,gid:0});
        var prefixes=expected.map(function(e){return e.path;}).concat(components.map(function(c){return c.target;}),
            absent,empty,plists,[first,'System/Library/Extensions','Library/Extensions','private/var/db/receipts']);
        // Extension directories are selected as individual records by the adapter
        // after the scan; selecting both complete trees would enlarge UI output.
        prefixes=prefixes.filter(function(p){return p!=='System/Library/Extensions' && p!=='Library/Extensions';});
        prefixes=prefixes.filter(function(p,i){return prefixes.indexOf(p)===i;});
        return {profile:profile,candidate:r.nvme.candidate,expected:expected,components:components,packages:packages,
            absent:absent,empty:empty,firstBoot:state,plists:plists,prefixes:prefixes};
    }
    function audit(plan,scan,details) {
        if(!scan || scan.validated!==true || !sha(scan.manifestSHA256) || !Array.isArray(scan.records) ||
            scan.entries<=0 || scan.logicalFileBytes<=0)throw new Error('A complete validated filesystem scan is required.');
        var byPath=Object.create(null);
        scan.records.forEach(function(r){if(!r || typeof r.path!=='string' || byPath[r.path])throw new Error('Duplicate inspected path.');byPath[r.path]=r;});
        function requireEntry(e) {
            var actual=byPath[e.path];
            if(!actual || !Object.keys(e).every(function(k){return k==='mode' && e.kind==='symlink' || same(e[k],actual[k]);}))throw new Error('Prepared system file or metadata differs: '+e.path);
        }
        plan.expected.forEach(requireEntry);
        plan.components.forEach(function(c){
            var actual=scan.records.filter(function(r){return r.path===c.target || r.path.indexOf(c.target+'/')===0;});
            if(actual.length!==c.entries.length)throw new Error('Prepared component membership differs: '+c.target);
            c.entries.forEach(function(e){var full={};Object.keys(e).forEach(function(k){full[k]=e[k];});full.path=c.target+(e.path?'/'+e.path:'');requireEntry(full);});
        });
        plan.absent.forEach(function(p){if(scan.records.some(function(r){return r.path===p || r.path.indexOf(p+'/')===0;}))throw new Error('Unexpected installer or unselected driver content: '+p);});
        plan.empty.forEach(function(p){if(!byPath[p] || byPath[p].kind!=='directory' || scan.records.some(function(r){return r.path.indexOf(p+'/')===0;}))throw new Error('Staging directory is not empty: '+p);});
        if(!details || !same(details.version,{ProductVersion:'10.9.5',ProductBuildVersion:'13F34'}) ||
            !same(details.bootOptions,{'Kernel Flags':''}) || !same(details.firstBoot,plan.firstBoot.state) ||
            !same(details.daemon,plan.firstBoot.daemon.content) || !same(details.notice,plan.firstBoot.notice.content) ||
            details.blessingVerified!==true || details.imageReadOnly!==true || details.cacheNewerThanInputs!==true)throw new Error('Final boot or first-boot state differs.');
        plan.packages.forEach(function(p){var r=details.packages[p.identifier];if(!r || r.PackageIdentifier!==p.identifier || r.PackageVersion!==p.version)throw new Error('Apple package receipt identity differs: '+p.identifier);});
        if(!plan.firstBoot.state.diagnosticsRequested && byPath[first+'/Diagnostics.log'])throw new Error('Diagnostics were not requested.');
        return {profile:plan.profile,candidate:plan.candidate,entries:scan.entries,logicalFileBytes:scan.logicalFileBytes,
            manifestSHA256:scan.manifestSHA256,verifiedComponents:plan.components.length,verifiedPackages:plan.packages.length,
            firstBootPending:true,bootTested:false};
    }
    function verify(io,receipt,catalogs,patchPlan,firstBootPlan) {
        var selected=plan(receipt,catalogs,patchPlan,firstBootPlan),stage=io.attachReadOnly(receipt),failure,result,scan;
        try {scan=io.scan(stage,selected);result=audit(selected,scan,io.inspect(stage,selected));}
        catch(e){failure=e;}
        try{io.detach(stage);}catch(e){throw new Error((failure?String(failure)+'\n':'')+'Final verification could not detach the private image: '+String(e));}
        if(failure)throw failure;
        var image=io.detachedImageIdentity(receipt);
        if(!image || !sha(image.sha256) || image.bytes<=0 || image.path!==receipt.image)throw new Error('Detached image identity did not verify.');
        return {kind:'mavericks-prepared-image',workflow:'direct',verified:true,manifestSHA256:result.manifestSHA256,
            manifest:scan.path,image:image,profile:result.profile,candidate:result.candidate,audit:result,
            firstBoot:receipt.firstBoot,nativeInitializationConfirmed:false,bootTested:false,physicalMutation:false};
    }
    function verifyDestination(io,receipt,catalogs,patchPlan,firstBootPlan){
        var selected=plan(receipt,catalogs,patchPlan,firstBootPlan),stage=io.attachReadOnly(receipt),failure,result,scan;
        try{scan=io.scan(stage,selected);result=audit(selected,scan,io.inspect(stage,selected));}catch(e){failure=e;}
        try{io.detach(stage);}catch(e){throw new Error((failure?String(failure)+'\n':'')+'Destination verification could not unmount: '+e);}
        if(failure)throw failure;
        return {kind:'mavericks-direct-installation',workflow:'direct',verified:true,audit:result,
            manifest:scan.path,manifestSHA256:result.manifestSHA256,profile:result.profile,candidate:result.candidate,
            firstBoot:receipt.firstBoot,firstBootPending:true,nativeInitializationConfirmed:false,bootTested:false,physicalMutation:true};
    }
    return {plan:plan,audit:audit,verify:verify,verifyDestination:verifyDestination};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionFinalVerification;
