#!/usr/bin/env python3
"""Build the application locally on macOS. Does not run it or change any volume."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import os
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_NAME = 'MavericksResurrection-1.0-beta.6.1.zip'
ENV = {key: value for key, value in os.environ.items()
       if key not in {'SDKROOT', 'MACOSX_DEPLOYMENT_TARGET', 'CPATH',
                      'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH', 'LIBRARY_PATH',
                      'CFLAGS', 'LDFLAGS'} and not key.startswith('DYLD_')}
ENV.update(LC_ALL='C', TZ='UTC', SOURCE_DATE_EPOCH='1793145600')

def run(*args):
    subprocess.run([str(x) for x in args], check=True, cwd=ROOT, env=ENV)

def capture(*args):
    return subprocess.check_output(args, cwd=ROOT, env=ENV, text=True).strip()

def toolchain():
    return {
        'compiler': capture('/usr/bin/xcrun', 'clang', '--version').splitlines()[0],
        'sdk': capture('/usr/bin/xcrun', '--show-sdk-version'),
        'linker': json.loads(capture('/usr/bin/xcrun', 'ld', '-version_details'))['version'],
        'macOSBuild': capture('/usr/bin/sw_vers', '-buildVersion'),
    }

def sign(path, identifier):
    run('/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none',
        '--identifier', identifier, '--digest-algorithm=sha1,sha256', path)

def archive(app, destination):
    # Fixed ordering, timestamps and permissions; stored entries avoid zlib-version differences.
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_STORED) as result:
        for path in [app] + sorted(app.rglob('*')):
            name = path.relative_to(app.parent).as_posix()
            directory = path.is_dir()
            info = zipfile.ZipInfo(name + ('/' if directory else ''), (2026, 10, 28, 0, 0, 0))
            info.create_system = 3
            mode = stat.S_IFDIR | 0o755 if directory else stat.S_IFREG | stat.S_IMODE(path.stat().st_mode)
            info.external_attr = mode << 16
            if directory:
                info.external_attr |= 0x10
            result.writestr(info, b'' if directory else path.read_bytes())

def main():
    os.umask(0o022)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'build')
    parser.add_argument('--allow-different-toolchain', action='store_true',
                        help='Build a custom app; its bytes may differ from the release.')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('Build on macOS with Apple Command Line Tools installed.')
    actual_toolchain = toolchain()
    expected_toolchain = json.loads((ROOT / 'packaging/build-toolchain.json').read_text())
    if actual_toolchain != expected_toolchain and not args.allow_different_toolchain:
        parser.error('Release toolchain mismatch. See packaging/build-toolchain.json; '
                     'use --allow-different-toolchain only for a custom build.\n' +
                     json.dumps(actual_toolchain, indent=2))
    output = args.output.resolve()
    app = output / 'MavericksResurrection.app'
    if app.exists():
        parser.error('Output app already exists; choose a new --output directory.')
    contents = app / 'Contents'
    resources = contents / 'Resources'
    shutil.copytree(ROOT / 'resources', resources)
    shutil.copytree(ROOT / 'src', resources / 'src')
    shutil.copyfile(ROOT / 'packaging/Info.plist', contents / 'Info.plist')
    for path in app.rglob('*'):
        path.chmod(0o755 if path.is_dir() else 0o644)
    tools = resources / 'BundledTools'
    tools.mkdir()
    catalog_path = resources / 'assets/NativeTools.json'
    catalog = json.loads(catalog_path.read_text())
    for name, record in catalog['tools'].items():
        stem = name.removesuffix('.dylib')
        source = resources / 'src' / (stem + '.m')
        if not source.exists():
            source = source.with_suffix('.c')
        target = '10.9' if name == 'FirstBootSetup' else '10.10'
        optimize = '-Os' if name in {'FidelityMetadata', 'VerifySharedCaches',
                                     'ImageRuntimeLaunch', 'ImageRuntimeRoot.dylib'} else '-O2'
        command = ['/usr/bin/xcrun', 'clang', '-arch', 'x86_64',
                   '-mmacosx-version-min=' + target, optimize,
                   '-Werror=unguarded-availability',
                   '-ffile-prefix-map=' + str(ROOT) + '=.',
                   '-ffile-prefix-map=' + str(output) + '=build',
                   '-Wl,-no_adhoc_codesign']
        if source.suffix == '.m':
            command += ['-fno-objc-arc', '-framework', 'Foundation']
        if name == 'FirstBootSetup':
            command += ['-framework', 'AppKit']
        if name == 'PostUpdateSnapshotStore':
            command += ['-DMUP_MODEL_STORE', '-DGM_POSTUPDATE_REPAIR']
        if name.endswith('.dylib'):
            command += ['-dynamiclib', '-Wl,-install_name,@rpath/' + name]
        binary = tools / name
        run(*command, source, '-o', binary)
        sign(binary, 'dev.Jaegermeister.MavericksResurrection.' + name)
        data = binary.read_bytes()
        record.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    catalog_path.write_text(json.dumps(catalog, indent=2) + '\n')
    (contents / 'MacOS').mkdir()
    launcher = contents / 'MacOS/MavericksResurrection'
    run('/usr/bin/xcrun', 'clang', '-arch', 'x86_64',
        '-mmacosx-version-min=12.0', '-O2', '-fno-objc-arc',
        '-ffile-prefix-map=' + str(ROOT) + '=.',
        '-ffile-prefix-map=' + str(output) + '=build',
        '-Wl,-no_adhoc_codesign',
        '-framework', 'AppKit', '-framework', 'OSAKit',
        resources / 'src/AppLauncher.m', '-o', launcher)
    # These scripts are executed by their interpreters, but preserve executable
    # permissions for people who inspect or invoke the bundled scripts directly.
    for script in (resources / 'src').iterdir():
        if script.suffix in ('.sh', '.rb'):
            script.chmod(0o755)
    import plistlib
    sign(app, plistlib.loads((contents / 'Info.plist').read_bytes())['CFBundleIdentifier'])
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', app)
    file_hashes = {path.relative_to(app).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                   for path in sorted(app.rglob('*')) if path.is_file()}
    (output / 'APP-FILE-HASHES.json').write_text(json.dumps(file_hashes, indent=2) + '\n')
    archive(app, output / ARCHIVE_NAME)
    print('Built:', app)
    print('ZIP SHA-256:', hashlib.sha256((output / ARCHIVE_NAME).read_bytes()).hexdigest())
    print('The app has not been launched.')

if __name__ == '__main__':
    main()
