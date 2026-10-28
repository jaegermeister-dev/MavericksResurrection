/* Saved selections belong to an installation, never to this Mac's preferences. */
var MavericksResurrectionExperimentsPolicy=(function(){
 'use strict';
 var definitions=[
  {id:'graphics-power',title:'Use the MacBookPro11,2 graphics power profile',description:'Adds the existing Mavericks Intel graphics power-management profile for MacBookPro11,4. Does not change the display driver.',conflicts:[]},
  {id:'intel-framebuffer',title:'Try Intel framebuffer compatibility',description:'Maps the MacBookPro11,4 framebuffer ID to Mavericks’ existing Iris Pro layout. May help a white screen, but is untested and may not boot.',conflicts:[]},
  {id:'cpu-power',title:'Use the MacBookPro11,2 CPU power profile',description:'Adds the existing Mavericks CPU power-management profile for MacBookPro11,4. This is separate from the graphics power profile.',conflicts:[]}
 ];
 function conflicts(id,selected,defs){
  defs=defs||definitions;var item=defs.filter(function(d){return d.id===id;})[0];if(!item)throw Error('Unknown experiment.');
  return selected.filter(function(other){if(other===id)return false;var d=defs.filter(function(x){return x.id===other;})[0];if(!d)throw Error('Unknown experiment.');return item.conflicts.indexOf(other)>=0||d.conflicts.indexOf(id)>=0;});
 }
 function validate(selected,defs){defs=defs||definitions;if(!Array.isArray(selected))throw Error('Invalid experimental settings.');var seen={};selected.forEach(function(id){if(seen[id]||!defs.some(function(d){return d.id===id;}))throw Error('Unknown or repeated experiment.');seen[id]=true;if(conflicts(id,selected,defs).length)throw Error('Conflicting experiments cannot be enabled together.');});return selected.slice();}
 function encode(selected){validate(selected);return definitions.map(function(d){return selected.indexOf(d.id)>=0?'1':'0';}).join('');}
 function decode(mask){if(typeof mask!=='string'||!/^[01]{3}$/.test(mask))throw Error('Invalid saved experimental settings.');return definitions.filter(function(d,i){return mask.charAt(i)==='1';}).map(function(d){return d.id;});}
 return {definitions:definitions,conflicts:conflicts,validate:validate,encode:encode,decode:decode};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionExperimentsPolicy;
