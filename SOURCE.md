# Beta 6.1 source

This is the source for **MavericksResurrection 1.0 Beta 6.1**.

The source is now available after a user pointed out that it had not been published. Previous release downloads were removed following reports of a memory leak, and for transparency because their source code had not been published. Beta 6.1 is being published with its matching source.

## What changed

The only functional change from public Beta 6 is in `src/MacProgressView.js`: the activity log explicitly uses TextKit 1. On Tahoe, the newer text layout engine could repeatedly allocate memory while updating the log, eventually freezing the interface and consuming large amounts of RAM and swap.

`release/MEMORY-FIX.patch` contains the complete source change. The application was signed again after that change. The release ZIP is the exact build tested, so its internal version still reads **1.0 Beta 6, build 105**. The download and GitHub release are named **Beta 6.1** to distinguish them from the affected release.

This release does not include the other changes under development for Beta 7.

## Source layout

- `src/`: application JavaScript, native launcher, C/Objective-C helpers, Ruby diagnostics and installer download script.
- `resources/`: the exact resource files and bundled patch payloads used by the release.
- `packaging/`: application metadata.
- `efi/`: Zig source for the EFI diagnostics tool embedded in `src/AdvancedEFISession.rb`.
- `nvme/`: compatibility shim source, tests, bridge descriptions and a checked transformation of the High Sierra driver binary.
- `tools/build.py`: local application build script.
- `release/APP-FILE-HASHES.json`: SHA-256 hashes of every file in the released app.

The application sources are copied directly from the tested app. This repository does not contain private development logs, SSH credentials or tester reports.

## Build the app

Use an Intel Mac running Monterey or newer, Apple Command Line Tools, and Python 3.9 or newer. From the repository directory:

```sh
python3 tools/build.py
```

The output is `build/MavericksResurrection.app`. The build script compiles the native launcher and every bundled host helper, updates their integrity records, and applies an ad-hoc signature. It does not launch the app or modify an installation. Use `--output /path/to/new-folder` for another build; an existing output app is never overwritten.

Builds made with a different SDK/compiler/signature need not be byte-identical to the release. The signed release ZIP and its checksum identify the tested build. The build script reuses the checked-in patch resources and the embedded EFI binary; rebuilding those is a separate step described below.

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
