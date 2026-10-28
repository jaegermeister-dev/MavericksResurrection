#!/usr/bin/env python3
"""Build the release app on macOS without launching it or changing an installation."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import plistlib
import shutil
import stat
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_NAME = 'MavericksResurrection-1.0-beta.7.zip'
ENV = {k: v for k, v in os.environ.items()
       if k not in {'SDKROOT', 'MACOSX_DEPLOYMENT_TARGET', 'CPATH', 'C_INCLUDE_PATH',
                    'CPLUS_INCLUDE_PATH', 'LIBRARY_PATH', 'CFLAGS', 'LDFLAGS'}
       and not k.startswith('DYLD_')}
ENV.update(LC_ALL='C', TZ='UTC')

def run(*args):
    subprocess.run([str(a) for a in args], check=True, cwd=ROOT, env=ENV)

def capture(*args):
    return subprocess.check_output([str(a) for a in args], cwd=ROOT, env=ENV,
                                   stderr=subprocess.STDOUT, text=True).strip()

def sign(path, identifier):
    run('/usr/bin/codesign', '--force', '--sign', '-', '--identifier', identifier,
        '--digest-algorithm=sha1,sha256', path)

def preserve_build_uuid(binary, spec):
    # Preserve this release's existing debug identifier only when its code matches.
    # This does not alter instructions, data, imports or runtime behaviour.
    if 'preserveUUID' not in spec:
        return
    data = bytearray(binary.read_bytes())
    if struct.unpack_from('<I', data)[0] != 0xfeedfacf:
        raise RuntimeError('Unexpected native binary format')
    at = 32
    uuid_offset = None
    code_hash = None
    for _ in range(struct.unpack_from('<I', data, 16)[0]):
        command, size = struct.unpack_from('<II', data, at)
        if command == 0x1b:
            uuid_offset = at+8
        if command == 0x19:
            for n in range(struct.unpack_from('<I', data, at+64)[0]):
                section = at+72+80*n
                if data[section:section+16].split(b'\0')[0] == b'__text':
                    length, offset = struct.unpack_from('<QI', data, section+40)
                    code_hash = hashlib.sha256(data[offset:offset+length]).hexdigest()
        at += size
    if uuid_offset is None or code_hash != spec['expectedCodeSHA256']:
        raise RuntimeError('Cannot preserve the build identifier for changed code')
    data[uuid_offset:uuid_offset+16] = bytes.fromhex(spec['preserveUUID'])
    binary.write_bytes(data)

def archive(app, destination):
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_STORED) as z:
        for path in [app] + sorted(app.rglob('*')):
            directory = path.is_dir()
            name = path.relative_to(app.parent).as_posix() + ('/' if directory else '')
            item = zipfile.ZipInfo(name, (2026, 10, 28, 0, 0, 0))
            item.create_system = 3
            mode = (stat.S_IFDIR | 0o755) if directory else (stat.S_IFREG | stat.S_IMODE(path.stat().st_mode))
            item.external_attr = (mode << 16) | (0x10 if directory else 0)
            z.writestr(item, b'' if directory else path.read_bytes())

def main():
    os.umask(0o022)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'build')
    parser.add_argument('--legacy-clt', type=Path, required=True,
                        help='CommandLineTools directory containing clang 14 and SDK 13.1')
    parser.add_argument('--current-clt', type=Path, default=Path('/Library/Developer/CommandLineTools'))
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('Build on macOS with both recorded Apple toolchains installed.')
    expected = json.loads((ROOT/'packaging/build-toolchain.json').read_text())
    if capture('/usr/bin/sw_vers', '-buildVersion') != expected['macOSBuild']:
        parser.error('Signing host differs from packaging/build-toolchain.json.')
    toolchains = {'13.1': args.legacy_clt.resolve(), '26.5': args.current_clt.resolve()}
    for sdk, clt in toolchains.items():
        compiler = capture(clt/'usr/bin/clang', '--version').splitlines()[0]
        linker = capture(clt/'usr/bin/ld', '-v')
        reference = expected['toolchains'][sdk]
        if compiler != reference['compiler'] or reference['linker'] not in linker:
            parser.error('Compiler/linker mismatch for SDK '+sdk)
        if not (clt/('SDKs/MacOSX'+sdk+'.sdk')).is_dir():
            parser.error('Missing macOS SDK '+sdk)
    output = args.output.resolve()
    app = output/'MavericksResurrection.app'
    if app.exists():
        parser.error('Output app already exists; choose a new --output directory.')
    contents = app/'Contents'
    resources = contents/'Resources'
    shutil.copytree(ROOT/'resources', resources)
    shutil.copytree(ROOT/'src', resources/'src')
    shutil.copyfile(ROOT/'packaging/Info.plist', contents/'Info.plist')
    tools = resources/'BundledTools'
    tools.mkdir()
    (contents/'MacOS').mkdir()
    config = json.loads((ROOT/'packaging/native-builds.json').read_text())
    for name, spec in config.items():
        clt = toolchains[spec['sdk']]
        destination = contents/'MacOS'/name if name == 'MavericksResurrection' else tools/name
        binary = destination.with_name(spec['outputName'])
        source = resources/'src'/spec['source']
        command = [clt/'usr/bin/clang', '-arch', 'x86_64', '-isysroot',
                   clt/('SDKs/MacOSX'+spec['sdk']+'.sdk'), '-B'+str(clt/'usr/bin'),
                   '-mmacosx-version-min='+spec['minimum'], spec['optimization']]
        if source.suffix == '.m':
            command += ['-fno-objc-arc']
            if name != 'MavericksResurrection':
                command += ['-framework', 'Foundation']
        if name in ['FirstBootSetup', 'MavericksResurrection']:
            command += ['-framework', 'AppKit']
        if name == 'MavericksResurrection':
            command += ['-framework', 'OSAKit']
        if name == 'PostUpdateSnapshotStore':
            command += ['-DMUP_MODEL_STORE', '-DGM_POSTUPDATE_REPAIR']
        if name.endswith('.dylib'):
            command += ['-dynamiclib', '-Wl,-install_name,'+spec['installName']]
            command += ['-Wl,-headerpad,'+spec['headerPadding']]
        run(*command, source, '-o', binary)
        preserve_build_uuid(binary, spec)
        if spec['identifier'] and name != 'MavericksResurrection':
            sign(binary, spec['identifier'])
        if binary != destination:
            binary.rename(destination)
    catalog_path = resources/'assets/NativeTools.json'
    catalog = json.loads(catalog_path.read_text())
    for name, record in catalog['tools'].items():
        data = (tools/name).read_bytes()
        record.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    catalog_path.write_text(json.dumps(catalog, indent=2)+'\n')
    modes = json.loads((ROOT/'packaging/file-modes.json').read_text())
    for path in app.rglob('*'):
        path.chmod(0o755 if path.is_dir() else modes[path.relative_to(app).as_posix()])
    sign(app, plistlib.loads((contents/'Info.plist').read_bytes())['CFBundleIdentifier'])
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', app)
    hashes = {f.relative_to(app).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest()
              for f in sorted(app.rglob('*')) if f.is_file()}
    (output/'APP-FILE-HASHES.json').write_text(json.dumps(hashes, indent=2)+'\n')
    archive(app, output/ARCHIVE_NAME)
    print('Built', len(hashes), 'app files. Use tools/verify_release.py to check the release hashes.')
    print('ZIP SHA-256:', hashlib.sha256((output/ARCHIVE_NAME).read_bytes()).hexdigest())
    print('The app has not been launched.')

if __name__ == '__main__':
    main()
