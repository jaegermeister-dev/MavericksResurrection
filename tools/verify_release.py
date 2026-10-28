#!/usr/bin/env python3
"""Check a locally built ZIP against the published release hashes."""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NAME = 'MavericksResurrection-1.0-beta.6.1.zip'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive', nargs='?', type=Path, default=ROOT / 'build' / NAME)
args = parser.parse_args()
expected = json.loads((ROOT / 'release/APP-FILE-HASHES.json').read_text())
with zipfile.ZipFile(args.archive) as archive:
    prefix = 'MavericksResurrection.app/'
    actual = {entry.filename[len(prefix):]: hashlib.sha256(archive.read(entry)).hexdigest()
              for entry in archive.infolist() if not entry.is_dir() and entry.filename.startswith(prefix)}
    if actual != expected:
        parser.exit(1, 'App files differ from the release.\n')
checksums = dict(line.split(None, 1)[::-1] for line in (ROOT / 'SHA256SUMS.txt').read_text().splitlines() if line.strip())
digest = hashlib.sha256(args.archive.read_bytes()).hexdigest()
if digest != checksums[NAME]:
    parser.exit(1, 'ZIP checksum differs from the release.\n')
print('Every app file and the complete ZIP match the release byte for byte.')
print('SHA-256:', digest)
