#!/usr/bin/env python3
"""Build the application locally on macOS. Does not run it or change any volume."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def run(*args):
    subprocess.run([str(x) for x in args], check=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'build')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('Build on macOS with Apple Command Line Tools installed.')
    output = args.output.resolve()
    app = output / 'MavericksResurrection.app'
    if app.exists():
        parser.error('Output app already exists; choose a new --output directory.')
    contents = app / 'Contents'
    resources = contents / 'Resources'
    shutil.copytree(ROOT / 'resources', resources)
    shutil.copytree(ROOT / 'src', resources / 'src')
    shutil.copyfile(ROOT / 'packaging/Info.plist', contents / 'Info.plist')
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
        command = ['/usr/bin/xcrun', 'clang', '-arch', 'x86_64',
                   '-mmacosx-version-min=' + target, '-O2']
        if source.suffix == '.m':
            command += ['-fno-objc-arc', '-framework', 'Foundation']
        if name == 'FirstBootSetup':
            command += ['-framework', 'AppKit']
        if name == 'PostUpdateSnapshotStore':
            command += ['-DMUP_MODEL_STORE', '-DGM_POSTUPDATE_REPAIR']
        if name.endswith('.dylib'):
            command += ['-dynamiclib']
        binary = tools / name
        run(*command, source, '-o', binary)
        run('/usr/bin/codesign', '--force', '--sign', '-',
            '--digest-algorithm=sha1,sha256', binary)
        data = binary.read_bytes()
        record.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    catalog_path.write_text(json.dumps(catalog, indent=2) + '\n')
    (contents / 'MacOS').mkdir()
    launcher = contents / 'MacOS/MavericksResurrection'
    run('/usr/bin/xcrun', 'clang', '-arch', 'x86_64',
        '-mmacosx-version-min=12.0', '-O2', '-fno-objc-arc',
        '-framework', 'AppKit', '-framework', 'OSAKit',
        resources / 'src/AppLauncher.m', '-o', launcher)
    # These scripts are executed by their interpreters, but preserve executable
    # permissions for people who inspect or invoke the bundled scripts directly.
    for script in (resources / 'src').iterdir():
        if script.suffix in ('.sh', '.rb'):
            script.chmod(0o755)
    run('/usr/bin/codesign', '--force', '--sign', '-',
        '--digest-algorithm=sha1,sha256', app)
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', app)
    print('Built:', app)
    print('The app has not been launched.')

if __name__ == '__main__':
    main()
