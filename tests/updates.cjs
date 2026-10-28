const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const src=process.argv[2],p=require(path.join(src,'UpdatePolicy.js'));
const release=tag=>({tag_name:tag,html_url:'https://github.com/jaegermeister-dev/MavericksResurrection/releases/tag/'+tag,published_at:'2026-10-26T21:29:36Z',draft:false,prerelease:false});
assert(p.available(release('v1.0-beta.7'),'1.0 Beta 6',''));
assert(p.available(release('v1.0-beta.10'),'1.0 Beta 9',''));
assert(!p.available(release('v1.0-beta.6'),'1.0 Beta 6',''));
assert(!p.available(release('v1.0-beta.5'),'1.0 Beta 6',''));
assert(!p.available(release('v1.0-beta.7'),'1.0 Beta 6','v1.0-beta.7'));
assert(p.available(release('v1.0-beta.8'),'1.0 Beta 6','v1.0-beta.7'));
assert(p.available(release('v1.0'),'1.0 Beta 99',''));
assert(!p.available(release('v1.0-beta.99'),'1.0',''));
assert(p.available(release('v1.1-beta.1'),'1.0',''));
assert(p.available(release('v1.0.1'),'1.0',''));
for(const invalid of [{draft:true},{prerelease:true},{html_url:'https://example.com/file.zip'},{published_at:''},{tag_name:'v1.0-beta.7/../../download'},{html_url:'https://github.com/other/repo/releases/tag/v1.0-beta.7'}]){
 assert(!p.available({...release('v1.0-beta.7'),...invalid},'1.0 Beta 6',''));
}
assert(!p.available(null,'1.0 Beta 6',''));assert(!p.available(release('v1.0-beta.7'),'unknown',''));
for(const n of ['UpdatePolicy.js','MacUpdateTransport.js','MacUpdateChecker.js','Main.js','MacMainWindow.js'])new Function(fs.readFileSync(path.join(src,n),'utf8'));
console.log(JSON.stringify({passed:true,numericVersionOrdering:true,stableAfterBeta:true,skipOnlyChosenRelease:true,olderAndCurrentSuppressed:true,untrustedReleaseURLsRejected:true,draftsAndUnpublishedRejected:true,sourceParses:true}));
