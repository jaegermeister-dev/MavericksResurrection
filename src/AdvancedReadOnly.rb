class Diagnostics
  LIMIT = 256 * 1024 * 1024
  LOG_LIMIT = 12 * 1024 * 1024
  KEXTS = %w[AppleMultitouchDriver AppleTopCase AppleUSBMultitouch IOBluetoothFamily AppleHDA AppleCameraInterface IO80211Family IONVMeFamily MavericksNVMeCompatibility AppleIntelFramebufferAzul AppleIntelHD5000Graphics AppleGraphicsControl AppleGraphicsPowerManagement IOPlatformPluginFamily AMD7000Controller AMDRadeonX4000 IOGraphicsFamily IONDRVSupport]

  def initialize
    @user = Etc.getpwuid(Integer(ENV.fetch('SUDO_UID')))
    @desktop = File.realpath(File.join(@user.dir, 'Desktop'))
    @summary = { 'tool' => 'MavericksResurrection read-only diagnostics', 'version' => '1.0 Beta 5',
      'started_utc' => Time.now.utc.iso8601, 'repairs_requested' => false,
      'files' => [], 'commands' => [], 'warnings' => [] }
    @copied_bytes = 0
    @mount_owned = false
    @fsck_finished = false
    @workspace = nil
    @report = nil
    @root = nil
    Dir.chdir('/')
  end

  def say(text)
    puts text
    File.open(File.join(@report, 'Activity.log'), 'ab') { |f| f.puts("[#{Time.now.utc.iso8601}] #{text}") } if @report
  end

  def warning(text)
    @summary['warnings'] << text
    say('NOTE: ' + text)
  end

  def text_file(name, data)
    path = File.join(@report, name)
    FileUtils.mkdir_p(File.dirname(path), :mode => 0700)
    File.open(path, File::WRONLY | File::CREAT | File::EXCL, 0600) { |f| f.write(data) }
  end

  def command(argv, name = nil, seconds = 60, input = nil, max = 32 * 1024 * 1024, progress = false)
    output = ''.b
    timed_out = false
    truncated = false
    status = nil
    start = Time.now
    file = name && File.join(@report, name)
    stream = file && File.open(file, File::WRONLY | File::CREAT | File::EXCL, 0600)
    last_notice = Time.now
    Open3.popen2e(*argv, :pgroup => true) do |stdin, pipe, wait|
      stdin.binmode
      stdin.write(input) if input
      stdin.close
      pipe.binmode
      begin
      loop do
        if Time.now - start > seconds || (ENV['MR_CANCEL_FILE'] && File.exist?(ENV['MR_CANCEL_FILE']))
          timed_out = true
          begin Process.kill('TERM', -wait.pid); rescue Errno::ESRCH; end
          unless wait.join(3)
            begin Process.kill('KILL', -wait.pid); rescue Errno::ESRCH; end
          end
          break
        end
        if progress && Time.now - last_notice >= 20
          say('Filesystem verification is still running; no repairs are being made.')
          last_notice = Time.now
        end
        next unless IO.select([pipe], nil, nil, 0.25)
        begin
          chunk = pipe.read_nonblock(65536)
          remaining = max - output.bytesize
          if remaining > 0
            take = chunk.byteslice(0, remaining)
            output << take
            stream.write(take) if stream
          end
          truncated = true if chunk.bytesize > remaining
        rescue IO::WaitReadable
          next
        rescue EOFError
          break
        end
      end
      rescue Interrupt
        begin Process.kill('TERM', -wait.pid); rescue Errno::ESRCH; end
        unless wait.join(3)
          begin Process.kill('KILL', -wait.pid); rescue Errno::ESRCH; end
        end
        raise
      end
      status = wait.value.exitstatus
    end
    @summary['commands'] << { 'argv' => argv, 'output' => name, 'exit_status' => status,
      'timed_out' => timed_out, 'output_truncated' => truncated, 'seconds' => (Time.now - start).round(2) }
    warning("Command timed out: #{argv.inspect}") if timed_out
    warning("Command output truncated: #{argv.inspect}") if truncated
    [output, timed_out ? 124 : status]
  ensure
    stream.close if stream && !stream.closed?
  end

  def plist(data)
    out, code = command(['/usr/bin/plutil', '-convert', 'json', '-o', '-', '-'], nil, 30, data)
    raise 'Cannot decode a property list.' unless code == 0
    JSON.parse(out)
  end

  def disk_info(device)
    out, code = command(['/usr/sbin/diskutil', 'info', '-plist', device])
    raise "Cannot read information for #{device}." unless code == 0
    plist(out)
  end

  def choose(args)
    explicit = nil
    if args.length > 0
      raise 'Unknown arguments. Use --help for instructions.' unless args.length == 2 && args[0] == '--device'
      explicit = args[1].sub(%r{\A/dev/}, '')
      raise 'Specify a partition, such as disk2s2, not a whole disk.' unless explicit =~ /\Adisk[0-9]+s[0-9]+\z/
    end
    raw, code = command(['/usr/sbin/diskutil', 'list', '-plist'])
    raise 'Cannot list disks.' unless code == 0
    @disk_list = raw
    identifiers = plist(raw).fetch('AllDisks', [])
    candidates = []
    identifiers.each do |identifier|
      next unless identifier =~ /\Adisk[0-9]+s[0-9]+\z/
      next if explicit && identifier != explicit
      begin
        info = disk_info(identifier)
        next unless info['FilesystemType'] == 'hfs' && info['WholeDisk'] == false
        next if ['/', '/System/Volumes/Data'].include?(info['MountPoint'])
        candidates << info
      rescue => e
        puts "Could not inspect #{identifier}: #{e.message}"
      end
    end
    raise 'No eligible HFS+ partitions found. The running macOS volume cannot be selected.' if candidates.empty?
    puts "\nSelect the partition containing the failed Mavericks installation."
    puts 'All HFS+ variants are listed, including unmounted partitions.'
    puts 'The installed OS version will be checked once read-only access is established.'
    candidates.each_with_index do |i, n|
      where = i['Internal'] == true ? 'Internal' : 'External / disk image'
      size = (i['TotalSize'].to_f / (1024**3)).round(1)
      state = i['MountPoint'].to_s.empty? ? 'unmounted' : 'mounted'
      puts "#{n + 1}) #{i['VolumeName'].to_s.inspect} | #{i['DeviceIdentifier']} | #{where} | #{size} GiB | #{i['FilesystemName']} | #{state}"
    end
    if explicit
      chosen = candidates.fetch(0)
    else
      print 'Partition number (or Q to cancel): '
      answer = $stdin.gets.to_s.strip
      raise 'Cancelled before accessing any partition.' if answer =~ /\Aq\z/i || answer.empty?
      raise 'Invalid selection.' unless answer =~ /\A[1-9][0-9]*\z/ && answer.to_i <= candidates.length
      chosen = candidates[answer.to_i - 1]
    end
    @device = '/dev/' + chosen.fetch('DeviceIdentifier')
    @raw_device = @device.sub('/dev/disk', '/dev/rdisk')
    raise 'The selected device is not a partition.' unless chosen['WholeDisk'] == false && chosen['VolumeUUID'].to_s.length > 0
    raise 'A locked or encrypted volume must be unlocked in Disk Utility first.' if chosen['Locked'] || chosen['Encrypted']
    [@desktop, File.realpath(__FILE__)].each do |p|
      out, code = command(['/bin/df', '-P', p])
      backing = out.lines.last.to_s.split.first.to_s
      raise 'Cannot establish where the script or Desktop is stored.' unless code == 0 && backing =~ %r{\A/dev/disk[0-9]+(?:s[0-9]+)*\z}
      raise 'The script and Desktop must be on your working macOS, not the selected partition.' if backing == @device
    end
    MRDiag::Session.new.tap {|s| begin s.recheck($mr_request.fetch('target')); ensure s.cleanup; end}
    raise 'The selected partition changed.' unless chosen['DiskUUID']==$mr_request.fetch('target')['DiskUUID'] && chosen['VolumeUUID']==$mr_request.fetch('target')['VolumeUUID']
    @identity = chosen
    @report = Dir.mktmpdir('MavericksResurrection-Diagnostics-' + Time.now.utc.strftime('%Y%m%dT%H%M%SZ') + '-', @desktop)
    @workspace = Dir.mktmpdir('MavericksResurrection-ReadOnly-', '/private/tmp')
    @root = File.join(@workspace, 'SelectedVolume')
    Dir.mkdir(@root, 0700)
    @summary['selected_partition'] = chosen
    text_file('DiskList.plist', @disk_list)
    text_file('SelectedPartition.json', JSON.pretty_generate(chosen))
    say("Selected #{chosen['VolumeName'].to_s.inspect} on #{@device}; volume UUID #{chosen['VolumeUUID']}.")
    say('The selected partition will be accessed read-only and left unmounted afterward.')
    say('Reports may include usernames, hardware identifiers and diagnostic log contents. Nothing is uploaded.')
    say('A normal unmount may flush writes that macOS already has pending; no repairs or patches are run.')
  end

  def revalidate
    current = disk_info(@device)
    ['DeviceIdentifier', 'VolumeUUID', 'DiskUUID', 'TotalSize'].each do |key|
      raise "Partition identity changed (#{key}); stopping." unless current[key] == @identity[key]
    end
    raise 'Selected device is no longer an HFS+ partition.' unless current['FilesystemType'] == 'hfs' && current['WholeDisk'] == false
    current
  end

  def mount_lines
    out, code = command(['/sbin/mount'])
    raise 'Cannot inspect mount state.' unless code == 0
    out.lines.select { |line| line.start_with?(@device + ' on ') }
  end

  def read_only_guard
    lines = mount_lines
    prefix = @device + ' on ' + @root + ' ('
    raise 'The selected partition is not exclusively mounted at the private read-only path.' unless lines.length == 1 && lines[0].start_with?(prefix) && lines[0] =~ /(?:\(|, )read-only(?:,|\))/
    @mount_dev ||= File.stat(@root).dev
    raise 'Read-only mount identity changed.' unless File.stat(@root).dev == @mount_dev
  end

  def prepare_volume
    current = revalidate
    if !mount_lines.empty? || !current['MountPoint'].to_s.empty?
      say('Closing the selected partition normally before read-only access...')
      _, code = command(['/usr/sbin/diskutil', 'unmount', @device], 'Unmount.txt', 60)
      raise 'The selected partition is busy. Close Finder windows and apps using it, then retry. No forced unmount was attempted.' unless code == 0
    end
    raise 'The selected partition is still mounted; verification was not started.' unless mount_lines.empty?
    revalidate
    say('Opening the selected partition read-only...')
    # Direct mount_hfs avoids Disk Arbitration initiating a repair/mount workflow.
    _, code = command(['/sbin/mount_hfs', '-o', 'rdonly,noexec,nosuid,nodev,nobrowse', @device, @root], 'ReadOnlyMount.txt', 60)
    if code == 0
      @mount_owned = true
      read_only_guard
      revalidate
      @summary['read_only_mount_confirmed'] = true
    else
      raise 'Unexpected mount appeared after the read-only mount failed.' unless mount_lines.empty?
      warning('The read-only mount failed. File logs may be unavailable; filesystem verification will still be attempted while unmounted.')
    end
  end

  def verify_filesystem
    @mount_owned ? read_only_guard : (raise('Unexpected mount; refusing filesystem check.') unless mount_lines.empty?)
    say('Checking the HFS+ filesystem with repairs disabled. This can take several minutes...')
    output, status = command(['/sbin/fsck_hfs', '-f', '-n', @raw_device], 'FilesystemCheck.txt', 1800, nil, 32 * 1024 * 1024, true)
    @summary['filesystem_check'] = { 'command' => ['/sbin/fsck_hfs', '-f', '-n', @raw_device], 'exit_status' => status,
      'repairs_enabled' => false, 'interpretation' => status == 0 ? 'Checker completed without reporting an error exit. See its full output.' : 'Checker reported errors or could not complete. See FilesystemCheck.txt; no repair was requested.' }
    @fsck_finished = true
    say("Filesystem checker finished with exit status #{status.inspect}. The output has been saved.")
  end

  def safe_path(relative)
    raise 'Invalid relative diagnostic path.' if relative.start_with?('/') || relative.split('/').any? { |p| p.empty? || p == '.' || p == '..' }
    at = @root
    relative.split('/').each do |part|
      at = File.join(at, part)
      st = File.lstat(at)
      raise "Skipping linked diagnostic path: #{relative.inspect}" if st.symlink?
      raise "Skipping a different filesystem: #{relative.inspect}" unless st.dev == @mount_dev
    end
    at
  end

  def copy_file(relative, tail = false, limit = LOG_LIMIT)
    source = safe_path(relative)
    stat = File.lstat(source)
    return unless stat.file?
    if @copied_bytes >= LIMIT
      warning('Report file-size limit reached; remaining files were skipped.') unless @size_warned
      @size_warned = true
      return
    end
    if stat.size > limit && !tail
      @summary['files'] << { 'path' => relative, 'bytes' => stat.size, 'skipped' => 'Exceeds per-file limit.' }
      return
    end
    count = [stat.size, limit, LIMIT - @copied_bytes].min
    offset = tail ? [stat.size - count, 0].max : 0
    dest = File.join(@report, 'SelectedVolumeFiles', relative)
    return if File.exist?(dest)
    FileUtils.mkdir_p(File.dirname(dest), :mode => 0700)
    digest = Digest::SHA256.new
    got = 0
    File.open(source, File::RDONLY | File::NOFOLLOW) do |input|
      raise 'Source file identity changed.' unless input.stat.ino == stat.ino && input.stat.dev == @mount_dev
      input.seek(offset)
      File.open(dest, File::WRONLY | File::CREAT | File::EXCL, 0600) do |out|
        while got < count
          data = input.read([65536, count - got].min)
          break unless data
          out.write(data)
          digest.update(data)
          got += data.bytesize
        end
      end
    end
    @copied_bytes += got
    @summary['files'] << { 'path' => relative, 'source_bytes' => stat.size, 'saved_bytes' => got,
      'source_offset' => offset, 'complete' => offset == 0 && got == stat.size,
      'sha256_of_saved_data' => digest.hexdigest, 'uid' => stat.uid, 'gid' => stat.gid,
      'mode' => sprintf('%04o', stat.mode & 07777), 'mtime_utc' => stat.mtime.utc.iso8601 }
  rescue Errno::ENOENT
    # Missing optional logs are normal before a successful first boot.
  rescue => e
    warning("Could not collect #{relative.inspect}: #{e.message}")
  end

  def files_in(relative, depth = 2)
    base = safe_path(relative)
    return [] unless File.directory?(base)
    files = []
    Find.find(base) do |path|
      st = File.lstat(path)
      if st.symlink? || st.dev != @mount_dev
        Find.prune if st.directory?
        next
      end
      if st.directory? && path.sub(base, '').count('/') > depth
        Find.prune
      end
      files << path.sub(@root + '/', '') if st.file?
      break if files.length >= 5000
    end
    files.sort_by { |p| -File.lstat(File.join(@root, p)).mtime.to_f }
  rescue Errno::ENOENT
    []
  rescue => e
    warning("Could not list #{relative.inspect}: #{e.message}")
    []
  end

  def collect_volume
    return unless @mount_owned
    read_only_guard
    say('Collecting Mavericks logs and installation records...')
    version = 'System/Library/CoreServices/SystemVersion.plist'
    begin
      data = File.binread(safe_path(version))
      @summary['installed_system'] = plist(data)
      warning('The selected partition does not identify itself as OS X 10.9. Filesystem results are still included.') unless @summary['installed_system']['ProductVersion'].to_s =~ /\A10\.9(?:\.|\z)/
    rescue => e
      warning("Cannot confirm the installed OS version: #{e.message}")
    end
    [version, 'System/Library/CoreServices/PlatformSupport.plist', 'Library/Preferences/SystemConfiguration/com.apple.Boot.plist',
      'Library/Receipts/InstallHistory.plist', 'System/Library/CoreServices/.disk_label.contentDetails'].each { |p| copy_file(p, false, 2 * 1024 * 1024) }
    logs = files_in('private/var/log', 0).select { |p| File.basename(p) =~ /\A(?:system|kernel|install|windowserver|fsck_hfs|fsck_hfs\.error)\.log(?:\..*)?\z/i }
    logs.first(50).each { |p| copy_file(p, p !~ /\.(?:gz|bz2)$/i) }
    ['Library/Logs/DiagnosticReports', 'Library/Logs/CrashReporter', 'Library/Logs/AppleFileSystemDriver'].each do |dir|
      files_in(dir, 2).first(80).each { |p| copy_file(p, false) }
    end
    # Retain original ASL files for old system/kernel entries; never run a target tool.
    files_in('private/var/log/asl', 0).select { |p| p.end_with?('.asl') }.first(16).each { |p| copy_file(p, false, 16 * 1024 * 1024) }
    ['Library/Application Support/MavericksResurrection'].each do |dir|
      files_in(dir, 5).select { |p| p =~ /\.(?:json|log|txt|plist)\z/i }.first(100).each { |p| copy_file(p, p.end_with?('.log'), 4 * 1024 * 1024) }
    end
    files_in('private/var/db/MavericksResurrection', 3).select { |p| p =~ /\.(?:json|log|txt|plist)\z/i }.first(50).each { |p| copy_file(p, false, 4 * 1024 * 1024) }
    # User crash reports only, not Documents, browser history, keychains or SSH keys.
    begin
      users_root = safe_path('Users')
      Dir.entries(users_root).sort.each do |user|
        next if user == '.' || user == '..'
        relative = 'Users/' + user + '/Library/Logs/DiagnosticReports'
        files_in(relative, 0).select { |p| File.basename(p) =~ /\A(?:WindowServer|hidd|loginwindow|kernel|MavericksResurrection)[_.-]/i }.first(15).each { |p| copy_file(p, false) }
      end
    rescue => e
      warning("User diagnostic reports unavailable: #{e.message}")
    end
    read_only_guard
    say('Recording driver versions and hashes (no driver binaries are included)...')
    inventory = []
    dirs = KEXTS.map { |k| 'System/Library/Extensions/' + k + '.kext' }
    dirs += ['Library/Extensions/WiFiCompat.kext', 'Library/Extensions/IONVMeFamily.kext', 'Library/Extensions/MavericksNVMeCompatibility.kext',
      'Library/CoreMediaIO/Plug-Ins/DAL/AppleCamera.plugin', 'System/Library/PrivateFrameworks/AppleVPA.framework',
      'System/Library/PrivateFrameworks/MultitouchSupport.framework']
    dirs.each do |dir|
      begin
        base = safe_path(dir)
        st = File.lstat(base)
        inventory << { 'path' => dir, 'uid' => st.uid, 'gid' => st.gid, 'mode' => sprintf('%04o', st.mode & 07777) }
        files_in(dir, 12).each do |relative|
          path = safe_path(relative)
          stat = File.lstat(path)
          entry = { 'path' => relative, 'bytes' => stat.size, 'uid' => stat.uid, 'gid' => stat.gid, 'mode' => sprintf('%04o', stat.mode & 07777) }
          if stat.size <= 64 * 1024 * 1024
            entry['sha256'] = Digest::SHA256.file(path).hexdigest
          else
            entry['hash_skipped'] = 'File exceeds 64 MiB.'
          end
          inventory << entry
          copy_file(relative, false, 2 * 1024 * 1024) if File.basename(relative) == 'Info.plist'
        end
      rescue Errno::ENOENT
        inventory << { 'path' => dir, 'present' => false }
      rescue => e
        warning("Could not inventory #{dir.inspect}: #{e.message}")
      end
    end
    ['mach_kernel', 'System/Library/CoreServices/boot.efi', 'System/Library/Caches/com.apple.kext.caches/Startup/kernelcache',
      'System/Library/PrelinkedKernels/prelinkedkernel', 'usr/libexec/hidd', 'System/Library/Frameworks/IOKit.framework/Versions/A/IOKit'].each do |relative|
      begin
        path = safe_path(relative)
        st = File.lstat(path)
        inventory << { 'path' => relative, 'bytes' => st.size, 'sha256' => Digest::SHA256.file(path).hexdigest,
          'uid' => st.uid, 'gid' => st.gid, 'mode' => sprintf('%04o', st.mode & 07777) } if st.file?
      rescue Errno::ENOENT
        inventory << { 'path' => relative, 'present' => false }
      rescue => e
        warning("Could not inventory #{relative.inspect}: #{e.message}")
      end
    end
    text_file('DriverAndBootInventory.json', JSON.pretty_generate(inventory))
    read_only_guard
  end

  def collect_host
    say('Collecting hardware information from the working macOS...')
    command(['/usr/bin/sw_vers'], 'HostOS.txt')
    command(['/usr/sbin/sysctl', 'hw.model', 'hw.memsize', 'machdep.cpu.brand_string'], 'HostModel.txt')
    command(['/usr/sbin/system_profiler', '-detailLevel', 'mini', '-timeout', '60', 'SPHardwareDataType', 'SPDisplaysDataType', 'SPNVMeDataType', 'SPSerialATADataType', 'SPUSBDataType', 'SPThunderboltDataType'], 'HostHardware.txt', 90)
    command(['/usr/sbin/ioreg', '-lw0', '-p', 'IOService'], 'HostIORegistry.txt', 60)
    command(['/usr/sbin/ioreg', '-lw0', '-p', 'IODeviceTree'], 'HostDeviceTree.txt', 60)
    command(['/sbin/mount'], 'HostMounts.txt')
    command(['/usr/sbin/nvram', 'boot-args'], 'HostBootArguments.txt')
    command(['/usr/sbin/nvram', '4D1FDA02-38C7-4A6A-9CC6-4BCCA8B30102:opencore-version'], 'HostOpenCoreVersion.txt')
  end

  def cleanup_mount
    return unless @root && @device
    lines = mount_lines
    if lines.any? { |line| line.start_with?(@device + ' on ' + @root + ' (') }
      say('Closing the private read-only mount...')
      _, status = command(['/sbin/umount', @root], 'CloseReadOnlyMount.txt', 60)
      warning("The read-only mount could not close normally; it remains at #{@root}. No forced unmount was attempted.") unless status == 0
    end
    @summary['final_mount_lines'] = mount_lines
    @summary['left_unmounted'] = @summary['final_mount_lines'].empty?
    if @summary['left_unmounted'] && @workspace
      Dir.rmdir(@root) if File.directory?(@root) && Dir.entries(@root).sort == ['.', '..']
      Dir.rmdir(@workspace) if Dir.entries(@workspace).sort == ['.', '..']
    end
  rescue => e
    warning("Mount cleanup could not finish: #{e.message}")
  end

  def finish
    return unless @report
    @summary['completed_utc'] = Time.now.utc.iso8601
    @summary['filesystem_check_completed'] = @fsck_finished
    @summary['saved_file_bytes'] = @copied_bytes
    text_file('Summary.json', JSON.pretty_generate(@summary))
    note = <<-TEXT
      MavericksResurrection read-only diagnostic report, version 1.0 Beta 5
      Selected partition: #{@identity['VolumeName'].inspect} (#{@device})
      Volume UUID: #{@identity['VolumeUUID']}
      Partition UUID: #{@identity['DiskUUID']}
      This report does not assume the selected partition was the source of either boot photo.

      Start with Summary.json and FilesystemCheck.txt.
      A nonzero fsck exit can mean corruption OR an incomplete check; read the actual output.
      Logs can be missing when boot failed before they were saved. Missing is not proof of success.
      Filesystem verification used -f -n: no repairs, journal replay command, patches, cache
      rebuilds, driver changes, NVRAM changes or EFI changes were requested.
      A normal unmount may have flushed writes already pending in the working macOS.
      The selected filesystem was accessed read-only for file collection. It is never
      remounted writable by this script. Final mount state is in Summary.json.

      SelectedVolumeFiles contains logs and small metadata files from the selected install.
      DriverAndBootInventory.json contains hashes, sizes and permissions, not driver binaries.
      Files listed as incomplete/truncated in Summary.json are not complete source copies.
      Host* files describe the working macOS, not drivers loaded in failed Mavericks.
      Hardware identifiers, usernames and other details can appear in the reports/logs.
      Nothing was uploaded. Send the ZIP privately to the person helping diagnose the boot.
    TEXT
    text_file('READ-ME.txt', note)
    zip = @report + '.zip'
    # ZIP lives on the working macOS Desktop, outside the selected partition.
    _, status = command(['/usr/bin/ditto', '-c', '-k', '--keepParent', @report, zip], nil, 120)
    Find.find(@report) { |p| File.lchown(@user.uid, @user.gid, p) }
    if status == 0 && File.file?(zip)
      File.chown(@user.uid, @user.gid, zip)
      puts "\nReport ready: #{zip}\nSend that ZIP to Jaegermeister-dev."
    else
      puts "\nCould not create the ZIP. The report folder is preserved: #{@report}"
    end
  end

  def run(args)
    begin
      choose(args)
      collect_host
      prepare_volume
      verify_filesystem
      collect_volume
    rescue Interrupt
      warning('Cancelled. The report contains everything collected before cancellation.')
    rescue => e
      warning(e.message)
      @summary['operation_error'] = e.message
    ensure
      cleanup_mount
      finish
    end
    raise(@summary['operation_error']) if !@report && @summary['operation_error']
  end
end
