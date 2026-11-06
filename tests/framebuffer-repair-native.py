#!/usr/bin/env python3
"""Exercise the packaged helper on a NEW disposable HFS+ image only.

Cache contents here are synthetic. This tests durable file/state/rollback
transactions, not real kextcache execution or a successful hardware boot.
"""
from pathlib import Path
import argparse, hashlib, json, os, plistlib, shutil, subprocess, tarfile

p = argparse.ArgumentParser()
p.add_argument('--helper', required=True)
p.add_argument('--fixtures', required=True)
p.add_argument('--work', required=True)
a = p.parse_args()
work = Path(a.work).resolve()
assert os.geteuid() == 0
assert not work.exists(), 'Use a new fixture directory; never reuse a volume.'
work.mkdir(parents=True)
mount = work / 'volume'
mount.mkdir()
image = work / 'test.sparseimage'
subprocess.run(['/usr/bin/hdiutil', 'create', '-size', '1g', '-type', 'SPARSE',
                '-fs', 'HFS+J', '-volname', 'MR114RepairFixture', str(image)], check=True)
subprocess.run(['/usr/bin/hdiutil', 'attach', '-nobrowse', '-owners', 'on',
                '-mountpoint', str(mount), str(image)], check=True)
results = []
azul = 'System/Library/Extensions/AppleIntelFramebufferAzul.kext/Contents/MacOS/AppleIntelFramebufferAzul'
cache = 'System/Library/Caches/com.apple.kext.caches/Startup/kernelcache'
infos = ['System/Library/Caches/com.apple.kext.caches/Startup/IOKitPersonalities_x86_64.ioplist.gz',
         'System/Library/Caches/com.apple.kext.caches/Startup/KextPropertyValues_OSBundleHelper_x86_64.plist.gz']
statefile = 'Library/Application Support/MavericksResurrection/Experiments/active-state.json'
original_hash = 'e9353f0646e93d733952325f1283985fc829978b54c644482739e65b56b583c4'
original_patched = 'a996bdb1e15908fbd7e5cb1554f46e2aef2b84fc47c98fd162a50dfbc07b7173'
updated_hash = 'dfdc6cca8454732713a1b4d11997d6fda792cfb9e90b58c34e0f5f2b2205c79a'
updated_patched = '630baf6a58d03aea890964f8088be3d5917762556a5034c134e1c96419d5e49e'

def write(name, data):
    dest = mount / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    os.chown(dest, 0, 0)
    os.chmod(dest, 0o644)

def sha(name):
    return hashlib.sha256((mount / name).read_bytes()).hexdigest()

def call(*args, fails=None):
    stat = mount.stat()
    c = subprocess.run([a.helper, str(mount), str(stat.st_dev), str(stat.st_ino),
                        *args], capture_output=True, text=True)
    if fails:
        assert c.returncode and fails in c.stderr, (args, c.returncode, c.stderr)
        return c.stderr.strip()
    assert c.returncode == 0, (args, c.stderr)
    return json.loads(c.stdout)

def begin(selection):
    saved = call('capture')
    return call('begin', saved['id'], selection)

def commit(tx, label):
    previous = sha(cache)
    write(cache, ('synthetic kernelcache ' + label).encode())
    for i, f in enumerate(infos):
        write(f, ('synthetic information cache %s %s' % (i, label)).encode())
    v = plistlib.loads((mount / 'System/Library/CoreServices/SystemVersion.plist').read_bytes())
    receipt = dict(kind='mavericks-post-update-caches', completed=True,
                   model='MacBookPro11,4', version=v['ProductVersion'], build=v['ProductBuildVersion'],
                   kernelSHA256=sha('mach_kernel'), toolSHA256=sha('usr/sbin/kextcache'),
                   previousCacheSHA256=previous, kernelcacheSHA256=sha(cache),
                   informationCaches={f: sha(f) for f in infos})
    return call('commit', tx['id'], json.dumps(receipt))

try:
    os.chown(mount, 0, 0)
    os.chmod(mount, 0o755)
    write('.metadata_never_index', b'')
    for directory in [
        'Library/Application Support',
        'System/Library/Extensions/AppleGraphicsPowerManagement.kext/Contents',
        'System/Library/Extensions/IOPlatformPluginFamily.kext/Contents/PlugIns/X86PlatformPlugin.kext/Contents/Resources']:
        (mount / directory).mkdir(parents=True, exist_ok=True)
    write('System/Library/CoreServices/SystemVersion.plist', plistlib.dumps(dict(ProductVersion='10.9.5', ProductBuildVersion='13F34')))
    agpm = 'System/Library/Extensions/AppleGraphicsPowerManagement.kext/Contents/Info.plist'
    agpm_data = plistlib.dumps({'CFBundleIdentifier':'com.apple.driver.AGPM', 'IOKitPersonalities':{'AGPM':{'Machines':{'Mac-3CBD00234E554E41':{'IGPU':{}}}}}})
    write(agpm, agpm_data)
    cpu_base = 'System/Library/Extensions/IOPlatformPluginFamily.kext/Contents/PlugIns/X86PlatformPlugin.kext/Contents/Resources/'
    with tarfile.open(Path(a.helper).parent.parent / 'BundledInputs/Released-Model-Support.tar.gz') as payload:
        donor = payload.extractfile('payload/model-11,5/' + cpu_base + 'Mac-3CBD00234E554E41.plist').read()
    assert hashlib.sha256(donor).hexdigest() == '13709ec5c51ff21527005877c0e366bb1af8c4abd35dab5dc449558a84bd5d13'
    write(cpu_base + 'Mac-3CBD00234E554E41.plist', donor)
    write('mach_kernel', b'fixture kernel')
    write('usr/sbin/kextcache', b'fixture tool')
    write(cache, b'initial fixture cache')
    for f in infos:
        write(f, b'initial fixture information cache')
    write(azul, (Path(a.fixtures) / 'original-Azul.bin').read_bytes())
    assert sha(azul) == original_hash
    fresh = bytearray((mount / azul).read_bytes())
    fresh[0x64d00] = 0x0e
    write(azul, fresh)
    assert sha(azul) == original_patched
    assert call('state')['selection'] == '000'
    assert call('assessment', '010')['changedIndices'] == [1]
    tx = begin('010')
    call('apply', tx['id'], '-')
    assert sha(azul) == original_patched
    commit(tx, 'adopt fresh Beta 8 alias')
    assert call('assessment', '010')['alreadySelected']
    tx = begin('000')
    call('apply', tx['id'], '-')
    commit(tx, 'restore adopted original')
    assert sha(azul) == original_patched
    write(azul, (Path(a.fixtures) / 'original-Azul.bin').read_bytes())
    results.append('fresh Beta 8 alias adopted without changing driver bytes')
    for mask in ['000', '100', '001', '101', '111', '110', '011', '010']:
        if not call('assessment', mask)['alreadySelected']:
            tx = begin(mask)
            call('apply', tx['id'], '-')
            commit(tx, 'old selection ' + mask)
        if not call('assessment', '010')['alreadySelected']:
            tx = begin('010')
            call('apply', tx['id'], '-')
            commit(tx, 'standard 010 from ' + mask)
        assert call('assessment', '010')['alreadySelected']
        assert sha(azul) == original_patched
        assert (mount / agpm).read_bytes() == agpm_data
        assert not (mount / (cpu_base + 'Mac-06F11FD93F0323C5.plist')).exists()
    tx = begin('000')
    call('apply', tx['id'], '-')
    commit(tx, 'reset after migration cases')
    assert sha(azul) == original_hash
    results.append('all eight old selections migrate to framebuffer-only using exact saved originals')
    assert call('assessment', '000')['alreadySelected']
    assert call('assessment', '010')['changedIndices'] == [1]
    tx = begin('010')
    call('apply', tx['id'], '-')
    assert sha(azul) == original_patched
    old = commit(tx, 'original enabled')
    assert call('assessment', '010')['alreadySelected']
    results.append('original 13F34 enable and repeat assessment')

    write('System/Library/CoreServices/SystemVersion.plist', plistlib.dumps(dict(ProductVersion='10.9.5', ProductBuildVersion='13F1911')))
    write(azul, (Path(a.fixtures) / 'updated-Azul.bin').read_bytes())
    write(cache, b'Apple updated fixture cache')
    before = {f: sha(f) for f in [azul, cache, statefile, *infos]}
    assessment = call('assessment', '010')
    assert assessment['changedIndices'] == [1] and not assessment['alreadySelected']
    assert assessment['enabled'] == [] and assessment['currentSelection'] == '010'
    call('assessment', '000', fails='no longer matches')
    tx = begin('010')
    call('apply', tx['id'], '-')
    assert sha(azul) == updated_patched
    write(cache, b'interrupted cache generation')
    assert call('recover')['status'] == 'recovered'
    assert call('pending')['pending'] is None
    assert before == {f: sha(f) for f in before}
    results.append('interrupted reapply restores updated driver, old selected state and caches')

    tx = begin('010')
    call('apply', tx['id'], '-')
    new = commit(tx, 'updated enabled')
    assert sha(azul) == updated_patched
    assert new['selection'] == '010'
    assert new['originals']['intel-framebuffer'] != old['originals']['intel-framebuffer']
    assert call('assessment', '010')['alreadySelected']
    snapshot = new['originals']['intel-framebuffer']
    saved = 'Library/Application Support/MavericksResurrection/Experiments/Snapshots/' + snapshot + '/slot-1'
    assert sha(saved) == updated_hash
    results.append('known update reapply retains updated original and is idempotent')

    tx = begin('000')
    call('apply', tx['id'], '-')
    off = commit(tx, 'disabled')
    assert sha(azul) == updated_hash and off['selection'] == '000'
    assert call('assessment', '000')['alreadySelected']
    results.append('disable restores updated Apple driver, never the old pre-update driver')

    bad = bytearray((mount / azul).read_bytes())
    bad[100] ^= 1
    write(azul, bad)
    before = {f: sha(f) for f in [azul, cache, statefile, *infos]}
    call('assessment', '010', fails='not supported')
    assert before == {f: sha(f) for f in before}
    write(azul, (Path(a.fixtures) / 'updated-Azul.bin').read_bytes())
    tx = begin('010')
    call('apply', tx['id'], '-')
    state = commit(tx, 'enable again')
    bad = bytearray((mount / azul).read_bytes())
    bad[100] ^= 1
    write(azul, bad)
    before = {f: sha(f) for f in [azul, cache, statefile, *infos]}
    call('assessment', '010', fails='no longer matches')
    assert before == {f: sha(f) for f in before}
    results.append('unknown unpatched and modified enabled binaries fail without changing managed files')

    write(azul, (Path(a.fixtures) / 'updated-Azul.bin').read_bytes())
    original = 'Library/Application Support/MavericksResurrection/Experiments/Snapshots/' + state['originals']['intel-framebuffer'] + '/slot-1'
    write(original, b'damaged rollback snapshot')
    call('assessment', '010', fails='verification failed')
    results.append('damaged prior rollback snapshot blocks automatic reapply')
    report = dict(passed=True, tests=results, realCacheRebuildTested=False,
                  scope='packaged native helper on disposable HFS+ image only')
    (work / 'RESULT.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)
finally:
    subprocess.run(['/usr/bin/hdiutil', 'detach', str(mount)], check=True)
