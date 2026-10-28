/* Construct the native administrator prompt command. User paths and serialized
 * requests are quoted as individual shell arguments, never executable text.
 * No credentials are collected or stored by MavericksResurrection. */
var MavericksResurrectionWorkerLaunch=(function(){
    'use strict';
    function absolute(p){if(typeof p!=='string' || p.charAt(0)!=='/' || /[\x00-\x1f\x7f]/.test(p))throw new Error('Worker paths must be absolute and contain no control characters.');return p;}
    function shell(s){if(typeof s!=='string' || s.indexOf('\x00')>=0)throw new Error('Invalid worker argument.');return "'"+s.replace(/'/g,"'\\''")+"'";}
    function apple(s){return '"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\n')+'"';}
    function stage(resources,request,events,errors){
        [resources,events,errors].forEach(absolute);
        if(!request || request.action!=='prepare-system' || request.target || request.disk || request.destination || request.test || request.allowImage)throw new Error('This administrator launcher only prepares a private image.');
        return launch('StageWorker',resources,request,events,errors);
    }
    function deploy(resources,request,events,errors){
        [resources,events,errors].forEach(absolute);
        if(!request || request.workflow!=='direct' || ['deploy-prepared-system','install-from-image'].indexOf(request.action)<0 || request.disk || request.destination || request.test || request.allowImage ||
            !request.approval || request.approval.first!==true || request.approval.second!==true || typeof request.approval.third!=='string' || request.approval.third.trim().toLowerCase()!=='confirm')throw new Error('Partition deployment requires all three format confirmations.');
        return launch(request.action==='install-from-image'?'DirectWorker':'DeployWorker',resources,request,events,errors);
    }
    function maintenance(resources,request,events,errors){
        [resources,events,errors].forEach(absolute);
        if(!request||['list-installations','inspect-installation','switch-nvme','recover-nvme','collect-diagnostics','list-repair-installations','inspect-repair','repair-updates','recover-repair'].indexOf(request.action)<0||request.disk||request.destination||request.test||request.allowImage||request.approval||request.format||request.partition||request.reinstall)throw new Error('This maintenance launcher only handles existing Mavericks installations.');
        absolute(request.workspace);return launch('MaintenanceWorker',resources,request,events,errors);
    }
    function launch(worker,resources,request,events,errors){
        var args=['/usr/bin/osascript','-l','JavaScript',resources+'/src/'+worker+'.js',resources,JSON.stringify(request)];
        var command=args.map(shell).join(' ')+' > '+shell(events)+' 2> '+shell(errors);
        return {executable:'/usr/bin/osascript',arguments:['-e','do shell script '+apple(command)+' with administrator privileges'],
            worker:worker,requiresAdministrator:true};
    }
    return {stage:stage,deploy:deploy,maintenance:maintenance};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionWorkerLaunch;
