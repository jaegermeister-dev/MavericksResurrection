/* GitHub release metadata only; update assets are never downloaded by the app. */
var MavericksResurrectionUpdatePolicy=(function(){
 'use strict';
 var api='https://api.github.com/repos/jaegermeister-dev/MavericksResurrection/releases/latest';
 var page='https://github.com/jaegermeister-dev/MavericksResurrection/releases/tag/';
 function version(s,label){
  if(typeof s!=='string'||s.length>64)return null;
  var m=(label?/^(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?(?: Beta (\d{1,6}))?$/i:/^v?(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?(?:-beta\.(\d{1,6}))?$/).exec(s);
  return m?{major:Number(m[1]),minor:Number(m[2]),patch:Number(m[3]||0),beta:m[4]===undefined?null:Number(m[4]),label:m[1]+'.'+m[2]+(m[3]!==undefined?'.'+m[3]:'')+(m[4]!==undefined?' Beta '+Number(m[4]):'')}:null;
 }
 function newer(a,b){
  for(var i=0,keys=['major','minor','patch'];i<keys.length;i++){var k=keys[i];if(a[k]!==b[k])return a[k]>b[k];}
  if(a.beta===null)return b.beta!==null;
  if(b.beta===null)return false;
  return a.beta>b.beta;
 }
 function available(record,currentLabel,skipped){
  if(!record||record.draft!==false||record.prerelease!==false||typeof record.published_at!=='string'||!isFinite(Date.parse(record.published_at)))return null;
  var remote=version(record.tag_name,false),local=version(currentLabel,true);
  if(!remote||!local||!newer(remote,local)||record.tag_name===skipped)return null;
  var url=page+record.tag_name;
  if(record.html_url!==url)return null;
  return {tag:record.tag_name,label:remote.label,url:url};
 }
 return {apiURL:api,maxResponseBytes:262144,version:version,newer:newer,available:available};
}());
if(typeof module!=='undefined')module.exports=MavericksResurrectionUpdatePolicy;
