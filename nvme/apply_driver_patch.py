#!/usr/bin/env python3
"""Reproduce the released IONVMeFamily binary from the exact High Sierra donor."""
from pathlib import Path
import argparse, base64, hashlib, json

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('donor',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    patch=json.loads(Path(__file__).with_name('driver-patch.json').read_text())
    original=args.donor.read_bytes()
    if len(original)!=patch['inputBytes'] or hashlib.sha256(original).hexdigest()!=patch['inputSHA256']:
        parser.error('This is not the exact supported High Sierra donor binary.')
    if args.output.exists():parser.error('Output already exists; choose a new file.')
    data=bytearray(original)
    # Reverse order keeps original offsets valid if a range changes length.
    for item in reversed(patch['ranges']):
        offset=item['offset'];old=base64.b64decode(item['originalBase64']);new=base64.b64decode(item['replacementBase64'])
        assert original[offset:offset+len(old)]==old
        data[offset:offset+len(old)]=new
    assert len(data)==patch['outputBytes']
    assert hashlib.sha256(data).hexdigest()==patch['outputSHA256']
    args.output.write_bytes(data)
    print('Verified released driver binary:', args.output)

if __name__=='__main__':main()
