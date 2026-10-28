# Beta 7 source

This is the source for **MavericksResurrection 1.0 Beta 7, build 107**.

The source was first published with Beta 6.1 after a user pointed out that it was missing. Earlier downloads were removed following memory leak reports and because their source had not been published. Beta 6.1 remains available.

## Release verification

The published source builds every application file and the complete release ZIP byte for byte. Two clean builds in different directories were compared, followed by a build from the exact published source archive. See `release/REPRODUCIBILITY.json`, `release/APP-FILE-HASHES.json` and `SHA256SUMS.txt`.

The tested Beta 7 passed a fresh installation and first boot on a MacBookPro11,5. Its display profile and usable HiDPI modes matched the native MacBookPro11,3 baseline. The final packaging removes a local build path from `ImageRuntimeRoot.dylib` and updates its checksum and app signatures. Every executable code/data section and runtime binding remains identical to the tested app. The original and rebuilt runtime also passed the same disposable HFS+ image test. A full installation was not repeated for this metadata-only cleanup.

Beta 7 keeps the activity-log memory fix, adds Big Sur support, corrects protected-folder verification, supplies the display profile through installation and post-update repair, and adds optional update notifications. It does not fix the reported 11,4 boot or 11,5 GPU-switching problems.

## Build

Use an Intel Mac with Python 3.9 or newer. The exact release uses the two Apple toolchains recorded in `packaging/build-toolchain.json`: clang 14.0.0 with SDK 13.1 and linker 820.1, and clang 21.0.0 with SDK 26.5 and linker 1267. Signing is performed on macOS build 25G241. These are build requirements; the app runs on Big Sur and newer.

Keep the older CommandLineTools installation in a separate folder. The build does not change the system's selected developer tools:

```sh
python3 tools/build.py --legacy-clt /path/to/older/CommandLineTools
python3 tools/verify_release.py
```

Use `--current-clt /path/to/current/CommandLineTools` if the newer toolchain is not at its standard location. Use `--output /path/to/new-folder` for a separate build; existing output apps are never overwritten.

The build compiles the launcher and all host helpers from `src/`, using the per-file settings in `packaging/native-builds.json`. It preserves the tested helpers' compiler versions and signatures. One helper's existing debug UUID is retained only after checking its compiled code hash. Library header padding preserves the tested instruction/data layout while removing the local path. These steps do not change application logic.

Outputs are `build/MavericksResurrection.app`, `build/MavericksResurrection-1.0-beta.7.zip` and `build/APP-FILE-HASHES.json`. ZIP ordering, timestamps and permissions are fixed. The build never launches the app or modifies a Mavericks installation.

## Source layout

- `src/`: JavaScript application, native launcher, C/Objective-C helpers, Ruby diagnostics and installer-download script.
- `resources/`: exact release resources and patch payloads.
- `packaging/`: app metadata and recorded build settings.
- `tests/`: policy, experimental-settings, update-check and Beta 7 checks.
- `efi/`: source for the embedded EFI diagnostics tool.
- `nvme/`: compatibility shim source and documented driver transformation.
- `tools/`: build and independent release-verification scripts.

The app sources and resources match the delivered app. Private development logs, SSH credentials and tester reports are not included. The build reuses the checked-in Apple patch resources and embedded EFI binary; their provenance and separate build steps are described below.

## EFI diagnostics

The released EFI was compiled with Zig `0.17.0-dev.2251+1175a3e99`:

```sh
zig build-exe efi/diagnostics.zig -target x86_64-uefi -O ReleaseSafe -femit-bin=MavericksDiagnostics.efi
```

The app embeds this binary and its SHA-256/size in the `PAYLOADS` record in `src/AdvancedEFISession.rb`. Changing the EFI requires updating that record before rebuilding the app. The EFI does not capture the macOS kernel console after firmware handoff.

## NVMe support

Apple's High Sierra `IONVMeFamily` is a binary component, not source code owned by this project. The compatibility shim and the project's binary modifications are included here. See `nvme/README.md` for the donor hash, reproducible binary transformation, and shim build commands.

## Third-party components

The MavericksForever adaptation retains its upstream attribution in `src/Download-MavericksForever.sh` and `resources/reference-only/MavericksForever/SOURCE-AND-CREDIT.txt`. Apple components and other third-party materials retain their existing ownership and terms. Publishing the application source does not turn Apple's driver binaries into open-source code or change their licensing.
