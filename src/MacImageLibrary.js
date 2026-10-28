/* Receipts beside app-built images establish their MavericksResurrection provenance.
 * Archive hashing is optional; usable installer contents are checked separately. */
var MavericksResurrectionMacImageLibrary=(function(){
    'use strict';ObjC.import('Foundation');
    function create(io){
        var fm=$.NSFileManager.defaultManager;
        function read(p){return JSON.parse(io.readText(io.canonicalFile(p)));}
        function same(a,b){return a.identity===b.identity&&a.bytes===b.bytes&&a.modified===b.modified;}
        function save(path,value){
            if(!$(JSON.stringify(value,null,2)+'\n').writeToFileAtomicallyEncodingError($(path),true,$.NSUTF8StringEncoding,null))throw new Error('Cannot save the image record.');
        }
        function imageKind(value,folder){
            if(value==='mavericksresurrection-image-record')return true;
            var parts=folder.split('/'),i=parts.lastIndexOf('Installers');
            return i>0&&value===parts[i-1].toLowerCase()+'-image-record';
        }
        function recordFor(folder){
            var names=ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError($(folder),null))||[];
            var found=names.filter(function(n){return /-IMAGE\.json$/i.test(n);});
            if(found.length>1)throw new Error('Multiple saved image records exist.');
            return folder+'/'+(found.length?found[0]:'SOURCE-VERIFIED.json');
        }
        function entry(record){
            record=io.canonicalFile(record);var folder=record.slice(0,record.lastIndexOf('/')),r=read(record);
            var marker=read(folder+'/.mavericks-source-job');
            if(marker.kind!=='MavericksForever' || r.version!=='10.9.5'||r.build!=='13F34')throw new Error('Not a MavericksResurrection MavericksForever build record.');
            var hash=null;
            if(imageKind(r.kind,folder)&&r.schema===1&&r.state==='available'&&r.filename==='InstallMacOSXMavericks.dmg')hash=r.sha256;
            else if(r.kind==='built-mavericksforever-image'&&/\/InstallMacOSXMavericks\.dmg$/.test(r.image))hash=r.imageSHA256||null;
            else throw new Error('This image is not available for reuse.');
            if(hash!==null&&!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid saved image checksum.');
            var path=io.canonicalFile(folder+'/InstallMacOSXMavericks.dmg'),s=io.stat(path);
            return {record:record,path:path,hash:hash,bytes:s.bytes,identity:s};
        }
        function selected(e){
            if(!e||!e.record)throw new Error('Choose an app-created image.');var value=entry(e.record);
            if(value.path!==e.path||value.hash!==e.hash||!same(value.identity,e.identity))throw new Error('The selected image or record changed. Select it again.');return value;
        }
        function register(built){
            var folder=built.job;if(built.image!==folder+'/InstallMacOSXMavericks.dmg'||built.kind!=='built-mavericksforever-image')throw new Error('Unexpected new image.');
            var path=folder+'/MAVERICKSRESURRECTION-IMAGE.json';if(fm.fileExistsAtPath($(path)))throw new Error('Image record already exists.');
            save(path,{schema:1,kind:'mavericksresurrection-image-record',version:'10.9.5',build:'13F34',filename:'InstallMacOSXMavericks.dmg',state:'available',sha256:null});return entry(path);
        }
        function hash(e,store){
            var current=selected(e);io.progress('hash-image',store?'Hashing the new installer DMG.':'Checking the saved installer DMG hash.',0);
            var actual=io.hashImage?io.hashImage(current.path):io.sha256(current.path);
            if(!same(current.identity,io.stat(current.path)))throw new Error('The image changed while hashing.');
            if(store){
                if(current.hash!==null)throw new Error('A saved baseline must not be overwritten.');var r=read(current.record);
                if(r.kind!=='mavericksresurrection-image-record')throw new Error('Unexpected new image record.');r.sha256=actual;save(current.record,r);
            }
            io.progress('hash-image','Installer DMG hash complete.',100);
            return {entry:entry(current.record),actual:actual,matches:current.hash===actual};
        }
        function discover(roots){
            var candidates=[],skipped=[],seen={};
            io.discover(roots).candidates.forEach(function(c){
                if(!/\/InstallMacOSXMavericks\.dmg$/.test(c.path))return;
                var parent=c.path.slice(0,c.path.lastIndexOf('/'));
                try{var value=entry(recordFor(parent));
                    if(!seen[value.path]){candidates.push(value);seen[value.path]=true;}
                }catch(e){skipped.push({path:c.path,reason:'No available MavericksResurrection build record.'});}
            });return {candidates:candidates,skipped:skipped};
        }
        function retire(e,disposition,actual){
            if(['move','delete'].indexOf(disposition)<0||!/^[a-f0-9]{64}$/.test(actual||''))throw new Error('Invalid mismatch action.');
            var current=selected(e),r=read(current.record),destination=null;
            if(io.sha256(current.path)!==actual||!same(current.identity,io.stat(current.path)))throw new Error('The image changed since the mismatch warning.');
            if(disposition==='move'){
                var desktop=ObjC.unwrap($.NSHomeDirectory())+'/Desktop';
                destination=desktop+'/Mavericks-checksum-mismatch-'+ObjC.unwrap($.NSUUID.UUID.UUIDString)+'.dmg';
                if(fm.fileExistsAtPath($(destination))||!fm.moveItemAtPathToPathError($(current.path),$(destination),null))throw new Error('Could not move the DMG to the Desktop. No replacement download started.');
            }else if(!fm.removeItemAtPathError($(current.path),null))throw new Error('Could not delete the selected DMG. No replacement download started.');
            // Retire the record without touching other downloads or job contents.
            r.kind='mavericksresurrection-image-record';r.schema=1;r.state=disposition==='move'?'moved':'deleted';r.filename='InstallMacOSXMavericks.dmg';r.movedTo=destination;r.sha256=current.hash;
            save(current.record,r);return {completed:true,disposition:disposition,destination:destination};
        }
        function removeUsed(e){
            var current=selected(e),r=read(current.record);
            var managed=ObjC.unwrap($(ObjC.unwrap($.NSHomeDirectory())+'/Library/Application Support/MavericksResurrection/Installers').stringByStandardizingPath.stringByResolvingSymlinksInPath);
            if(current.record.indexOf(managed+'/')!==0||current.path.indexOf(managed+'/')!==0||
                r.kind!=='mavericksresurrection-image-record'||current.path!==current.record.slice(0,current.record.lastIndexOf('/'))+'/InstallMacOSXMavericks.dmg')throw new Error('Only the selected app-created DMG in Application Support can be deleted after installation.');
            io.progress('delete-used-image','Deleting the installer DMG after successful installation.',0);
            selected(current);
            if(!fm.removeItemAtPathError($(current.path),null))throw new Error('The installer DMG could not be deleted. It remains in Application Support.');
            r.state='deleted';r.deletedAfterInstallation=true;
            var result={completed:true,path:current.path,recordUpdated:true};
            try{save(current.record,r);}catch(error){result.recordUpdated=false;result.message='The DMG was deleted, but its build record could not be updated: '+String(error);}
            return result;
        }
        return {entry:entry,selected:selected,register:register,hash:hash,discover:discover,retire:retire,removeUsed:removeUsed};
    }
    return {create:create};
}());
