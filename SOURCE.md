# Beta 9 source

This is the source for **MavericksResurrection 1.0 Beta 9, build 109**.

The source was first published with Beta 6.1 after a user pointed out that it was missing. Earlier downloads were removed following memory leak reports and because their source had not been published. Beta 6.1 remains available.

## Release verification

The published source builds every application file and the complete release ZIP byte for byte. Independent clean builds in different directories were compared, including a build from the accompanying source archive. See `release/REPRODUCIBILITY.json`, `release/APP-FILE-HASHES.json` and `SHA256SUMS.txt`.

Beta 9 fixes the protected-volume check when macOS runs a downloaded app through App Translocation, and corrects the version label used by the update checker. The build now rejects a mismatch between that label and the app bundle version. The reported Downloads launch was checked on a MacBookPro11,5. Installation, driver and post-update patch handling are unchanged from Beta 8.

Beta 8 adds the verified MacBookPro11,4 framebuffer alias to fresh installations and restores it after software updates. The same fix was tested on 11,4 hardware, including graphics, Retina scaling, HDMI video/audio and internal audio. The 11,5 installation and patch configuration is unchanged from Beta 7; its graphics switching issue remains separate.

The 11,4 payload changes only byte 0x64d00 from 0x07 to 0x0e in Mavericks' original AppleIntelFramebufferAzul executable. It maps the model's framebuffer ID to the existing Iris Pro layout. The original 13F34 SHA-256 is `e9353f0646e93d733952325f1283985fc829978b54c644482739e65b56b583c4`; the output is `a996bdb1e15908fbd7e5cb1554f46e2aef2b84fc47c98fd162a50dfbc07b7173`. The post-update fixer applies the same change to the supported updated driver without downgrading it. Its original SHA-256 is `dfdc6cca8454732713a1b4d11997d6fda792cfb9e90b58c34e0f5f2b2205c79a`; the output is `630baf6a58d03aea890964f8088be3d5917762556a5034c134e1c96419d5e49e`. Unknown binaries are rejected.

## Build

Use an Intel Mac with Python 3.9 or newer. The exact release uses the two Apple toolchains recorded in `packaging/build-toolchain.json`: clang 14.0.0 with SDK 13.1 and linker 820.1, and clang 21.0.0 with SDK 26.5 and linker 1267. Signing is performed on macOS build 25G241. These are build requirements; the app runs on Big Sur and newer.

Keep the older CommandLineTools installation in a separate folder. The build does not change the system's selected developer tools:

```sh
python3 tools/build.py --legacy-clt /path/to/older/CommandLineTools
python3 tools/verify_release.py
```

Use `--current-clt /path/to/current/CommandLineTools` if the newer toolchain is not at its standard location. Use `--output /path/to/new-folder` for a separate build; existing output apps are never overwritten.

The build compiles the launcher and all host helpers from `src/`, using the per-file settings in `packaging/native-builds.json`. It preserves the tested helpers' compiler versions and signatures. One helper's existing debug UUID is retained only after checking its compiled code hash. Library header padding preserves the tested instruction/data layout while removing the local path. These steps do not change application logic.

Outputs are `build/MavericksResurrection.app`, `build/MavericksResurrection-1.0-beta.9.zip` and `build/APP-FILE-HASHES.json`. ZIP ordering, timestamps and permissions are fixed. The build never launches the app or modifies a Mavericks installation.

## Source layout

- `src/`: JavaScript application, native launcher, C/Objective-C helpers, Ruby diagnostics and installer-download script.
- `resources/`: exact release resources and patch payloads.
- `packaging/`: app metadata and recorded build settings.
- `tests/`: policy, update-check, framebuffer repair, legacy recovery and model regression checks.
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
