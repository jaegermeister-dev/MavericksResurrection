# 1.0 Beta 7

Added Big Sur support and fixed installation verification failing on protected folders such as .Spotlight-V100. SIP can stay enabled.

Added the missing display profile for higher Retina scaling options. Existing installations can get it through Fix post-update issues.

Added an update notification with a link to the new GitHub release. It does not download or install updates. Update checks can be turned off in Preferences.

Includes the memory leak fix from Beta 6.1. MacBookPro11,4 boot problems and graphics switching are still being investigated.

Matching source and build instructions are included. A local build path was removed before packaging; executable code is unchanged from the tested Beta 7. Beta 6.1 remains available.

# 1.0 Beta 6.1

Fixed a memory leak in the activity log that could freeze the app and use excessive RAM and swap space on Tahoe. This is Beta 6 with only the memory leak fix.

Published the source code after a user pointed out that it wasn't available.

Previous releases were taken down following reports of a memory leak, and for transparency because their source code had not been published.

Corrected the build instructions: the first Beta 6.1 upload reused older compiled helpers, so a fresh source build did not match it. The download now comes directly from the published build script, with byte-for-byte matching clean builds. The source archive and checksums have been updated too. The app's code changes remain limited to the memory leak fix; it does not include Beta 7 changes.

The version shown inside the app still says Beta 6 (build 105). The earlier memory-fix package passed installation testing; this rebuild passed reproducibility and targeted checks, but has not had another full installation test.
