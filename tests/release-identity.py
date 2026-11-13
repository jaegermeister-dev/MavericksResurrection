"""Reject the stale updater label that was accidentally shipped in Beta 8."""
import importlib.util
import json
import pathlib
import plistlib
from unittest import mock

root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('release_build',root/'tools/build.py')
build=importlib.util.module_from_spec(spec);spec.loader.exec_module(build)
build.validate_release_identity()
identity=json.loads((root/'resources/assets/AppIdentity.json').read_text())
identity['releaseLabel']='1.0 Beta 7'
with mock.patch.object(build.json, 'loads', return_value=identity):
    try: build.validate_release_identity()
    except RuntimeError as error: assert 'releaseLabel' in str(error)
    else: raise AssertionError('Stale updater label accepted')
print('Release identity matches bundle metadata; stale updater label rejected.')
