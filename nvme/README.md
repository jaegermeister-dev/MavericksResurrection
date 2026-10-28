# Mavericks NVMe compatibility

The bundled NVMe driver consists of Apple's High Sierra `IONVMeFamily` binary, the project's checked binary modifications, and `MavericksNVMeCompatibility.c`.

The shim adapts selected later IOKit APIs to Mavericks. Local vtable thunks are placed in executable `__TEXT` padding; the accompanying JSON reports describe the symbol mappings, buffer attributes, segment layout and thunk offsets. These changes preserve the donor's original driver instruction/data range described in `TEXT-BRIDGES.json`.

## Reproduce the released driver binary

Obtain the original High Sierra `IONVMeFamily` executable from its kext. The required SHA-256 is:

`30e60f9fe1a521fe9a94a8e20c515ca6dcc2302ae4953a84163550222646884a`

```sh
python3 nvme/apply_driver_patch.py /path/to/original/IONVMeFamily ./IONVMeFamily-patched
```

The script verifies every replacement range against the original and verifies the complete output hash:

`368dabc204f7c9038909cc11c014b901dc44d277d7bb84a008e58fa13073bfde`

`driver-patch.json` describes the exact transformation used by the release. `retarget-macho-symbols.py` contains the symbol-table editing implementation used during development. The reports describe the intermediate stages; they are not instructions to load an intermediate driver.

## Compile and test the shim

Use a macOS SDK containing `Kernel.framework/Headers` and an x86_64 kext-capable Apple linker. The original shim was built on Monterey. From `nvme/`, in a separate build directory or copy:

```sh
sdk="$(xcrun --show-sdk-path)"
kernel="$sdk/System/Library/Frameworks/Kernel.framework/Headers"
clang -arch x86_64 -mmacosx-version-min=10.9 -Wall -Wextra -Werror -O2 -fno-builtin test_MavericksNVMeCompatibility.c -o compat-unit-test
./compat-unit-test
clang -arch x86_64 -mmacosx-version-min=10.9 -isysroot "$sdk" -I "$kernel" -DKERNEL -DKERNEL_PRIVATE -mkernel -fno-builtin -fno-stack-protector -mno-red-zone -Wall -Wextra -Werror -O2 -c MavericksNVMeCompatibility.c -o compatibility.o
ld -arch x86_64 -kext -macosx_version_min 10.9 -o MavericksNVMeCompatibility compatibility.o
```

The source retains its original prototype comments. The released combination was subsequently tested on the Apple SM0256L in a MacBookPro11,5; other NVMe drive compatibility remains experimental.

The provided plist files match the released kext and shim. The app's payload archive, JSON inventories and generated `NVMeInventory.h` must agree if a developer changes any driver file. The normal application build intentionally reuses the tested payload unchanged.
