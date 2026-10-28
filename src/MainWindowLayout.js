/* Content dimensions, independent of AppKit so small-screen layouts can be checked. */
var MavericksResurrectionMainWindowLayout=(function(){
    'use strict';
    function restoredSize(saved,screen){
        var width=saved&&Number(saved.width),height=saved&&Number(saved.height);
        if(!isFinite(width)||!isFinite(height)||width<640||height<520){width=720;height=600;}
        var maxWidth=Math.max(640,Number(screen.width)-40),maxHeight=Math.max(520,Number(screen.height)-60);
        return {width:Math.min(Math.round(width),maxWidth),height:Math.min(Math.round(height),maxHeight)};
    }
    function frames(width,height){
        if(!isFinite(width)||!isFinite(height)||width<640||height<520)throw new Error('Window content is below the usable minimum.');
        var inner=width-44,column=(inner-12)/2,right=22+column+12;
        return {
            heading:[26,height-48,width-52,28],subtitle:[27,height-85,width-54,32],
            sourceLabel:[27,height-111,width-54,22],source:[24,height-146,width-48,30],
            changeDriver:[22,height-188,column,33],removeDriver:[right,height-188,column,33],
            repair:[22,height-227,column,33],diagnostics:[right,height-227,column,33],
            debug:[22,height-266,width-44,33],
            progress:[27,105,width-54,height-385],help:[27,64,width-54,32],
            logging:[22,20,160,33],credits:[187,20,88,33],support:[27,3,width-54,14],
            cancel:[width-314,20,100,33],install:[width-209,20,187,33]
        };
    }
    return {initial:{width:720,height:600},minimum:{width:640,height:520},frames:frames,restoredSize:restoredSize};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionMainWindowLayout;
