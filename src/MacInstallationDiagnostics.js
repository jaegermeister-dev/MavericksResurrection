/* Collect only MavericksResurrection first-boot state/output from an offline install.
 * The selected volume is never written. Exact private snapshots are streamed to
 * the GUI's explicitly selected diagnostic log, including non-UTF8 bytes. */
var MavericksResurrectionMacInstallationDiagnostics=(function(){
    'use strict';ObjC.import('Foundation');
    function collect(stage,guard,io,emit,cancelled){
        var fm=$.NSFileManager.defaultManager,folder='Library/Application Support/MavericksResurrection/FirstBoot',files=[];
        function check(){guard(stage);if(cancelled&&cancelled())throw new Error('Diagnostic collection cancelled.');}
        function path(relative,publicStatus){
            check();var at=stage.root,parts=relative.split('/');
            for(var i=0;i<parts.length;i++){
                var names=io.directoryNames(at);if(names.indexOf(parts[i])<0)return null;
                at+='/'+parts[i];var item=io.stat(at);
                if(item.kind!==(i===parts.length-1?'file':'directory'))throw new Error('Linked or unexpected first-boot diagnostic path.');
            }
            // Status is0644 so the unprivileged login notice can read it.
            // Raw command output remains0600. Also accept older private status.
            var s=io.stat(at),allowed=publicStatus?[384,420]:[384];
            if(s.uid!==0||s.gid!==0||allowed.indexOf(s.mode)<0)throw new Error('The first-boot diagnostic file has unexpected permissions.');return at;
        }
        check();if(stage.root==='/'||typeof stage.job!=='string'||!stage.job.length)throw new Error('An offline installation and private workspace are required.');
        var support='Library/Application Support',matched=[];
        if(!path(folder+'/State.json',true)){
            io.directoryNames(stage.root+'/'+support).forEach(function(name){
                if(!name||name==='.'||name==='..'||name.indexOf('/')>=0)return;
                var base=support+'/'+name,meta=io.stat(stage.root+'/'+base);if(meta.kind!=='directory')return;
                var candidate=base+'/FirstBoot',state=path(candidate+'/State.json',true);if(!state)return;
                var r=JSON.parse(io.readText(state));
                if(r.schema===1&&r.version==='10.9.5'&&r.build==='13F34'&&typeof r.installID==='string'&&/^[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12}$/.test(r.installID)&&Array.isArray(r.steps))matched.push(candidate);
            });
            if(matched.length>1)throw new Error('More than one first-boot record was found.');
            if(matched.length)folder=matched[0];
        }
        ['State.json','Diagnostics.log'].forEach(function(name){
            var source=path(folder+'/'+name,name==='State.json');if(!source){emit('installation.diagnostics.absent',{name:name});return;}
            var before=io.stat(source);io.ensureFree(stage.job,before.bytes+16*1024*1024);var original=io.sha256(source);
            check();io.copyFile(source,stage.job,'collected-firstboot/'+name);var snapshot=stage.job+'/collected-firstboot/'+name;
            if(io.stat(snapshot).bytes!==before.bytes||io.sha256(snapshot)!==original||JSON.stringify(io.stat(source))!==JSON.stringify(before)||io.sha256(source)!==original)throw new Error('First-boot diagnostics changed during collection.');
            emit('installation.diagnostics.file',{name:name,bytes:before.bytes,sha256:original,encoding:'base64'});
            var handle=$.NSFileHandle.fileHandleForReadingAtPath($(snapshot)),offset=0;
            if(!handle||handle.isNil())throw new Error('Cannot read the private diagnostic snapshot.');
            try{while(true){check();var data=handle.readDataOfLength(65536),count=Number(data.length);if(!count)break;
                emit('installation.diagnostics.chunk',{name:name,offset:offset,bytes:count,data:ObjC.unwrap(data.base64EncodedStringWithOptions(0))});offset+=count;}}
            finally{handle.closeFile;}
            if(offset!==before.bytes||io.sha256(snapshot)!==original)throw new Error('The diagnostic snapshot changed while exporting.');
            check();var receipt={name:name,bytes:offset,sha256:original,complete:true};emit('installation.diagnostics.file-complete',receipt);files.push(receipt);
        });
        guard.revalidate();return {kind:'mavericksresurrection-firstboot-diagnostics',complete:true,files:files,targetModified:false};
    }
    return {collect:collect};
}());
