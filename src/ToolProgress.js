/* Streaming numeric output from Apple's hdiutil and installer. */
var MavericksResurrectionToolProgress=(function(){
    'use strict';
    function create(kind,update,output){
        var pending='';
        function line(s){
            var m=kind==='image'?s.match(/^PERCENT:\s*(-?[0-9.]+)\s*$/):s.match(/^installer:%\s*([0-9.]+)\s*$/);
            if(m){var n=Number(m[1]);update(isFinite(n)&&n>=0&&n<=100?n:null);}
            else if(s.trim()&&output)output(s);
        }
        return {push:function(chunk){var parts=(pending+chunk).split(/[\r\n]/);pending=parts.pop();parts.forEach(line);if(pending.length>16384)pending=pending.slice(-16384);},
            finish:function(){if(pending)line(pending);pending='';}};
    }
    return {create:create};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionToolProgress;
