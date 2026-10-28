/* Presentation only. A percentage must come from measured worker progress;
 * unknown-duration commands have a task label and log, never a guessed bar. */
var MavericksResurrectionProgressPresentation=(function(){
    'use strict';
    var titles={download:'Downloading Mavericks','download-progress':'Downloading Mavericks',
        'verify-bytes':'Checking file integrity',verify:'Checking Mavericks files','verify-download':'Checking the downloaded Mavericks image',freeze:'Copying Mavericks source files',
        build:'Building the installer image','image-convert':'Converting the installer image',
        'build-copy':'Adding Mavericks to the installer image','verify-image':'Checking the finished installer image',
        components:'Preparing Mavericks packages','install-package':'Installing Mavericks onto your partition','hash-image':'Checking the installer DMG checksum',
        'delete-used-image':'Deleting the installer DMG',
        'model-patches':'Applying Mac compatibility patches',caches:'Building Mavericks boot caches',
        'offline-setup':'Setting up Mavericks','verify-system':'Checking the prepared Mavericks system',
        'verify-source-before-format':'Checking the prepared Mavericks image',
        'format-partition':'Formatting the selected partition','copy-system':'Installing Mavericks',
        'copy-metadata':'Preserving file permissions','verify-copy':'Checking the installed files',
        'discover-installations':'Finding Mavericks installations','repair-updates':'Fixing post-update issues'};
    function clean(text){return String(text||'').replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').replace(/\r/g,'\n')
        .split('\n').filter(function(s){return !/^\s*[#*=>\- ]+\d+(?:\.\d+)?%\s*$/.test(s);}).join('\n').trim();}
    function progress(event){
        var percent=typeof event.percent==='number'&&isFinite(event.percent)&&event.percent>=0&&event.percent<=100?event.percent:null;
        var message=clean(event.message),title=titles[event.phase]||'Working on Mavericks';
        if(event.phase==='download-progress')message=percent===null?'Connecting to Apple…':'Downloading Mavericks';
        return {title:title,message:message.replace(/\n+/g,' ').slice(-500),percent:percent,
            label:percent===null?'':(Math.round(percent*10)/10)+'%'};
    }
    function log(event){
        if(event.type==='progress'){var p=progress(event);return p.message+(p.percent===null?'':' — '+p.label);}
        if(event.type==='error')return 'Error: '+clean(event.message);
        if(event.type==='result')return 'Task completed.';
        if(event.type!=='diagnostic')return '';
        var d=event.detail||{};
        if(/(?:^|\.)command\.started$/.test(event.event))return 'Running '+d.program+' '+(d.arguments||[]).join(' ');
        if(/(?:^|\.)command\.finished$/.test(event.event)){
            var out=clean(d.output);
            // Property lists and filesystem inventories belong in the optional full
            // diagnostic file. Keep the live log useful while retaining errors.
            if(/^<\?xml|^\{\s*"|^\[\s*\{/.test(out))out='';
            return (out?out.slice(-12000)+'\n':'')+'Finished '+d.program+' (exit '+d.status+').';
        }
        return clean(event.event)+(d.message?': '+clean(d.message):'');
    }
    return {progress:progress,log:log,clean:clean};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionProgressPresentation;
