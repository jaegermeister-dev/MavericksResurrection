/* Native AppKit controls available on Yosemite. Used by the main window and
 * isolated worker windows. The visible log stays in memory unless saved. */
var MavericksResurrectionMacProgressView=(function(){
    'use strict';ObjC.import('AppKit');ObjC.import('Foundation');
    var presentation=MavericksResurrectionProgressPresentation;
    function label(x,y,w,h,text,bold){var v=$.NSTextField.alloc.mrInitWithXYWidthHeight(x,y,w,h);
        v.stringValue=$(text);v.editable=false;v.selectable=true;v.bezeled=false;v.drawsBackground=false;v.cell.wraps=true;
        v.font=bold?$.NSFont.boldSystemFontOfSize(13):$.NSFont.systemFontOfSize(12);return v;}
    function create(width,height){
        var view=$.NSView.alloc.mrInitWithXYWidthHeight(0,0,width,height);
        var title=label(0,height-24,width-90,24,'Ready to install Mavericks',true),
            percent=label(width-85,height-24,85,24,'',false),
            status=label(0,height-64,width,36,'Choose an installer source, then click Install Mavericks.',false);
        percent.alignment=$.NSRightTextAlignment;
        var bar=$.NSProgressIndicator.alloc.mrInitWithXYWidthHeight(0,height-78,width,12);
        bar.indeterminate=false;bar.minValue=0;bar.maxValue=100;bar.doubleValue=0;bar.hidden=true;
        var heading=label(0,height-109,width,22,'Activity log',true);
        var scroll=$.NSScrollView.alloc.mrInitWithXYWidthHeight(0,0,width,height-111);
        scroll.hasVerticalScroller=true;scroll.hasHorizontalScroller=false;scroll.borderType=$.NSBezelBorder;
        var text=$.NSTextView.alloc.mrInitWithXYWidthHeight(0,0,width-20,height-111);
        // Use the classic text layout engine before attaching the log to a
        // scroll view. Tahoe TextKit 2 was observed looping in viewport
        // estimation and allocating tens of GB while this log updated.
        // Accessing layoutManager explicitly selects TextKit 1 on newer
        // macOS and uses the existing engine on older supported hosts.
        text.layoutManager;
        text.editable=false;text.selectable=true;text.richText=false;text.font=$.NSFont.userFixedPitchFontOfSize(11);
        text.textColor=$.NSColor.textColor;text.backgroundColor=$.NSColor.textBackgroundColor;
        text.verticallyResizable=true;text.horizontallyResizable=false;
        text.autoresizingMask=$.NSViewWidthSizable;
        text.textContainer.mrSetContainerSizeWithWidthHeight(width-22,10000000);text.textContainer.widthTracksTextView=true;
        scroll.documentView=text;
        [title,percent,status,bar,heading,scroll].forEach(function(v){view.addSubview(v);});
        var lastLine='',previousDownloadBucket=-1;
        function append(message){
            message=presentation.clean(message);if(!message||message===lastLine)return;lastLine=message;
            var stamp=new Date().toTimeString().slice(0,8),line='['+stamp+'] '+message+'\n';
            var attrs=$.NSMutableDictionary.dictionary;attrs.setObjectForKey($.NSFont.userFixedPitchFontOfSize(11),$.NSFontAttributeName);
            attrs.setObjectForKey($.NSColor.textColor,$.NSForegroundColorAttributeName);
            var start=Number(text.textStorage.length);
            text.textStorage.replaceCharactersInRangeWithString($.NSMakeRange(start,0),$(line));
            text.textStorage.addAttributesRange(attrs,$.NSMakeRange(start,line.length));
            var length=Number(text.textStorage.length);
            if(length>300000)text.textStorage.deleteCharactersInRange($.NSMakeRange(0,length-250000));
            text.scrollRangeToVisible($.NSMakeRange(Number(text.textStorage.length),0));
        }
        return {view:view,title:title,status:status,progress:bar,log:text,
            resize:function(w,h){
                view.mrSetFrameSizeWithWidthHeight(w,h);
                title.mrSetFrameWithXYWidthHeight(0,h-24,w-90,24);percent.mrSetFrameWithXYWidthHeight(w-85,h-24,85,24);
                status.mrSetFrameWithXYWidthHeight(0,h-64,w,36);bar.mrSetFrameWithXYWidthHeight(0,h-78,w,12);
                heading.mrSetFrameWithXYWidthHeight(0,h-109,w,22);scroll.mrSetFrameWithXYWidthHeight(0,0,w,h-111);
                text.textContainer.mrSetContainerSizeWithWidthHeight(w-22,10000000);
            },
            append:append,
            message:function(message){title.stringValue=$(message);status.stringValue=$('');bar.hidden=true;percent.stringValue=$('');append(message);},
            begin:function(request){previousDownloadBucket=-1;bar.hidden=true;percent.stringValue=$('');
                var names={build:'Downloading Mavericks',freeze:'Checking your Mavericks installer image',discover:'Finding saved Mavericks images',
                    'prepare-system':'Preparing Mavericks for installation','deploy-prepared-system':'Installing Mavericks on your selected partition',
                    'list-installations':'Finding Mavericks installations','inspect-installation':'Checking this Mavericks installation',
                    'switch-nvme':'Changing the experimental NVMe driver','recover-nvme':'Restoring the preceding driver',
                    'collect-diagnostics':'Collecting installation diagnostics'};
                title.stringValue=$(names[request.action]||'Working on Mavericks');status.stringValue=$('Starting…');append(ObjC.unwrap(title.stringValue));},
            event:function(event){
                if(event.type==='progress'){
                    var p=presentation.progress(event);title.stringValue=$(p.title);status.stringValue=$(p.message);percent.stringValue=$(p.label);
                    bar.hidden=p.percent===null;if(p.percent!==null)bar.doubleValue=p.percent;
                    if(event.phase==='download-progress'&&p.percent!==null){var bucket=Math.floor(p.percent);if(bucket===previousDownloadBucket)return;previousDownloadBucket=bucket;}
                }
                append(presentation.log(event));
            },
            stopping:function(message){bar.hidden=true;percent.stringValue=$('');status.stringValue=$(message);append(message);},
            finish:function(success){bar.hidden=true;percent.stringValue=$('');if(success){title.stringValue=$('Task completed');status.stringValue=$('');} }
        };
    }
    return {create:create};
}());
