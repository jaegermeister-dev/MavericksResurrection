#!/usr/bin/ruby
require 'json'
require 'stringio'
require 'find'
require_relative 'AdvancedEFISession'
require_relative 'AdvancedReadOnly'

def event(value); STDOUT.write(JSON.generate(value)+"\n"); STDOUT.flush; end
module Kernel
  def puts(*args); args.each {|s| event({'type'=>'progress','phase'=>'advanced-diagnostics','message'=>s.to_s})}; end
  def print(*args); end
end

class AppEFISession < MRDiag::Session
  def initialize(request)
    super(); @request=request;@picks=0
  end
  def choose(list,prompt)
    key=(@request['action']=='advanced-prepare' && @picks==0) ? 'target' : 'efi'
    @picks+=1
    selected=@request.fetch(key)
    match=list.find {|i| i['DeviceIdentifier']==selected['DeviceIdentifier']}
    raise 'The selected partition is no longer eligible.' unless match
    recheck(selected)
  end
  def inventory; @inventory ||= super; end
  def report_path; @report; end
  def cases(efi)
    mount=fat_mount(efi,true)
    base=MRDiag.safe_existing(mount,'EFI/'+MRDiag::BASE,true)
    Dir.entries(base).select {|n| n =~ /\Acase-[A-Za-z0-9-]+\z/i}.sort.select do |n|
      begin
        cp=MRDiag.safe_existing(base,n,true)
        marker=MRDiag.safe_existing(cp,'ALLOW-DIAGNOSTICS.txt')
        File.size(marker)==MRDiag::MARKER.bytesize && File.binread(marker)==MRDiag::MARKER
      rescue;false;end
    end
  end
end

begin
  raise 'Administrator authorization required.' unless Process.uid==0
  raise 'Invalid advanced-tool invocation.' unless ARGV.length==2
  uid=Etc.getpwnam(ARGV[0]).uid;raise 'A normal macOS user is required.' unless uid>=501 && uid<2147483647
  ENV['SUDO_UID']=uid.to_s;ENV['MR_CANCEL_FILE']=nil
  ENV['PATH']='/usr/bin:/bin:/usr/sbin:/sbin';ENV['LC_ALL']='C';File.umask(0077)
  raise 'Request too large.' if ARGV[1].bytesize>65536
  request=JSON.parse(ARGV[1]);$mr_request=request
  allowed=%w[advanced-inventory advanced-cases advanced-prepare advanced-collect advanced-readonly]
  raise 'Unknown advanced action.' unless allowed.include?(request['action'])
  raise 'Unexpected request fields.' unless (request.keys-%w[action target efi case observation confirmed cancelFile]).empty?
  cancel=request['cancelFile']
  raise 'Invalid cancellation path.' unless cancel.is_a?(String) && cancel.start_with?('/') && !cancel.match(/[\x00-\x1f]/)
  ENV['MR_CANCEL_FILE']=cancel
  raise 'Cancelled before starting.' if File.exist?(cancel)
  if request['action']=='advanced-readonly'
    raise 'Confirm read-only collection first.' unless request['confirmed']==true
    d=Diagnostics.new;d.run(['--device',request.fetch('target').fetch('DeviceIdentifier')])
    path=d.instance_variable_get(:@report)
    raise 'No diagnostic report was created.' unless path
    summary=d.instance_variable_get(:@summary)
    result={'path'=>File.file?(path+'.zip') ? path+'.zip' : path,'summary'=>summary.reject {|k,v| %w[commands files].include?(k)}}
  else
    session=AppEFISession.new(request)
    begin
      case request['action']
      when 'advanced-inventory'
        rows=session.inventory
        result={'targets'=>rows.select {|i| i['FilesystemType']=='hfs' && !i['WholeDisk'] && !['/','/System/Volumes/Data'].include?(i['MountPoint'])},
                'efis'=>rows.select {|i| i['FilesystemType']=='msdos' && i['Content']=='EFI' && !i['WholeDisk']}}
      when 'advanced-cases'
        result={'cases'=>session.cases(request.fetch('efi'))}
      when 'advanced-prepare'
        raise 'Confirm EFI preparation first.' unless request['confirmed']==true
        $stdin=StringIO.new("y\n");session.prepare
        result={'path'=>session.report_path,'prepared'=>true}
      when 'advanced-collect'
        names=session.cases(request.fetch('efi'));idx=names.index(request.fetch('case'))
        raise 'The selected case disappeared.' unless idx
        observation=request.fetch('observation','').to_s.gsub(/[\r\n]/,' ')[0,4096]
        $stdin=StringIO.new("#{idx+1}\nOpenCore -> OpenShell\n#{observation}\nSee observations above\nSee observations above\n")
        session.collect;result={'path'=>session.report_path+'.zip','collected'=>true}
      end
    ensure
      session.cleanup
    end
  end
  event({'type'=>'result','result'=>result})
rescue => e
  event({'type'=>'error','message'=>e.message});warn(e.full_message);exit 1
end
