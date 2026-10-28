/* Optional archive checks are independent of installer-content validation. */
var MavericksResurrectionSourceAcquisition=(function(){
    'use strict';
    function acquire(execute,ui,initial,preferred){
        var route=preferred||ui.choice();if(!route)return null;
        if(['new','retained'].indexOf(route)<0)throw new Error('Unknown source choice.');
        var storage=ui.workspace(route,initial);if(!storage)return null;
        var workspace=storage.path,deleteAfterInstallation=route==='new'&&storage.deleteAfterInstallation===true;
        if(typeof workspace!=='string'||workspace.charAt(0)!=='/')throw new Error('Invalid installer storage folder.');
        var selected,integrity={status:'not-requested'};
        while(true){
            if(route==='new'){
                var built=execute({action:'build',workspace:workspace});
                selected=built.library;
                if(!selected)throw new Error('The new image was not recorded.');
                if(ui.hashNew(selected)){
                    var hashed=execute({action:'hash-built',entry:selected});selected=hashed.entry;
                    integrity={status:'recorded',actual:hashed.actual};
                }
            }else{
                var saved=ui.savedFolder(),catalog=saved?execute({action:'discover',roots:Array.isArray(saved)?saved:[saved]}):{candidates:[],skipped:[]};
                selected=ui.retained(catalog);
                if(!selected)return null;
                if(selected.hash && ui.verifyReuse(selected)){
                    var checked=execute({action:'check-image-hash',entry:selected});selected=checked.entry;
                    integrity={status:checked.matches?'matched':'mismatched',expected:selected.hash,actual:checked.actual};
                    if(!checked.matches){
                        var action=ui.mismatch(selected,checked);
                        if(action==='cancel')return null;
                        if(action==='use')integrity.status='overridden';
                        else if(action==='move'||action==='delete'){
                            execute({action:'retire-image',entry:selected,disposition:action,actualHash:checked.actual});
                            route='new';integrity={status:'not-requested'};continue;
                        }else throw new Error('Unknown checksum-mismatch choice.');
                    }
                }
            }
            var source=execute({action:'inspect',image:selected.path,entry:selected,workspace:workspace});
            source.workspace=workspace;source.library=selected;source.integrity=integrity;
            source.deleteAfterInstallation=deleteAfterInstallation;return source;
        }
    }
    return {acquire:acquire};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionSourceAcquisition;
