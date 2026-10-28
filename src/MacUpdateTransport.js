/* Asynchronous metadata request. Delegate callbacks are scheduled on the main
 * run loop and never display UI or execute release-provided content.
 * NSURLConnection dispatches delegate selectors directly. Do not require
 * NSURLConnectionDataDelegate in the JXA bridge: it is unavailable there on Big Sur. */
var MavericksResurrectionMacUpdateTransport=(function(){
 'use strict';ObjC.import('Foundation');
 var active=null,policy=MavericksResurrectionUpdatePolicy;
 function owner(connection){return active&&active.connection&&Boolean(active.connection.isEqual(connection))?active:null;}
 function finish(s,result){if(s.done)return;s.done=true;s.result=result;s.data=null;if(s.connection)s.connection.cancel;}
 ObjC.registerSubclass({name:'MavericksResurrectionUpdateConnectionDelegate',superclass:'NSObject',methods:{
  'connection:willSendRequest:redirectResponse:':{types:['id',['id','id','id']],implementation:function(c,request,response){var s=owner(c);if(!s)return null;if(response&&!response.isNil()){finish(s,{ok:false,reason:'redirect'});return null;}return request;}},
  'connection:didReceiveResponse:':{types:['void',['id','id']],implementation:function(c,response){var s=owner(c);if(!s||s.done)return;var status=Number(response.statusCode);if(status!==200){finish(s,{ok:false,reason:'http',status:status});return;}if(Number(response.expectedContentLength)>policy.maxResponseBytes){finish(s,{ok:false,reason:'oversized'});return;}s.data=$.NSMutableData.alloc.init;}},
  'connection:didReceiveData:':{types:['void',['id','id']],implementation:function(c,data){var s=owner(c);if(!s||s.done)return;if(!s.data||Number(s.data.length)+Number(data.length)>policy.maxResponseBytes){finish(s,{ok:false,reason:'oversized'});return;}s.data.appendData(data);}},
  'connection:didFailWithError:':{types:['void',['id','id']],implementation:function(c,error){var s=owner(c);if(s)finish(s,{ok:false,reason:'network',code:Number(error.code)});}},
  'connectionDidFinishLoading:':{types:['void',['id']],implementation:function(c){var s=owner(c);if(!s||s.done)return;try{var text=$.NSString.alloc.initWithDataEncoding(s.data,$.NSUTF8StringEncoding);if(!text||text.isNil())throw Error('Invalid text');finish(s,{ok:true,record:JSON.parse(ObjC.unwrap(text))});}catch(_){finish(s,{ok:false,reason:'invalid-response'});}}}
 }});
 function create(){
  var s={connection:null,data:null,result:null,done:false,started:false,deadline:0,delegate:null};
  return {
   start:function(){if(s.started&&!s.done)return;s.started=true;s.done=false;s.result=null;s.data=null;s.deadline=Date.now()+12000;
    try{
     if(active&&!active.done)finish(active,{ok:false,reason:'cancelled'});active=s;
     var request=$.NSMutableURLRequest.requestWithURLCachePolicyTimeoutInterval($.NSURL.URLWithString($(policy.apiURL)),$.NSURLRequestReloadIgnoringLocalCacheData,10);
     request.HTTPShouldHandleCookies=false;request.setValueForHTTPHeaderField($('application/vnd.github+json'),$('Accept'));request.setValueForHTTPHeaderField($('MavericksResurrection'),$('User-Agent'));
     s.delegate=$.MavericksResurrectionUpdateConnectionDelegate.alloc.init;
     s.connection=$.NSURLConnection.alloc.initWithRequestDelegateStartImmediately(request,s.delegate,false);
     if(!s.connection||s.connection.isNil())throw Error('No connection');
     s.connection.scheduleInRunLoopForMode($.NSRunLoop.mainRunLoop,$.NSRunLoopCommonModes);s.connection.start;
    }catch(_){finish(s,{ok:false,reason:'unavailable'});}
   },
   takeResult:function(){if(s.started&&!s.done&&Date.now()>s.deadline)finish(s,{ok:false,reason:'timeout'});var r=s.result;s.result=null;return r;},
   cancel:function(){finish(s,{ok:false,reason:'cancelled'});s.result=null;if(active===s)active=null;}
  };
 }
 return {create:create};
}());
