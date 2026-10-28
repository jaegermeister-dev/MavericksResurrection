/* Turn curl's terminal meter into numeric download progress. A pipe read can
 * split a percentage anywhere, so consume complete CR/LF-delimited updates. */
var MavericksResurrectionDownloadProgress=(function(){
    'use strict';
    function create(update,output){
        var pending='',previous=null;
        function line(text){
            var match=String(text).match(/(?:^|[\s#*=\-])(\d{1,3}(?:\.\d+)?)%\s*$/);
            if(!match){if(output&&String(text).trim())output(String(text).trim());return;}
            var value=Number(match[1]);
            if(!isFinite(value)||value<0||value>100||value===previous)return;
            previous=value;update(value);
        }
        return {
            push:function(chunk){
                var lines=(pending+String(chunk)).split(/[\r\n]/);pending=lines.pop();
                lines.forEach(line);
                // Bound unexpected terminal output without publishing it in the UI.
                if(pending.length>4096)pending=pending.slice(-4096);
            },
            finish:function(){line(pending);pending='';}
        };
    }
    function cleanFailure(error){
        // Failed commands retain their output tail for diagnostics. Remove meter
        // records from the error dialog too, including a truncated first record.
        var lines=String(error||'').replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').split(/[\r\n]/);
        return lines.map(function(line){return line.replace(/[#*=>\-][#*=>\- ]*(?:\d+(?:\.\d+)?%?)?\s*$/,'').trim();}).filter(function(line){
            return line && !/^[#*=>\- ]*(?:\d+(?:\.\d+)?%?)?$/.test(line);
        }).join('\n').replace(/^Error:\s*/,'').slice(-4000) || 'The Mavericks download did not complete.';
    }
    return {create:create,cleanFailure:cleanFailure};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionDownloadProgress;
