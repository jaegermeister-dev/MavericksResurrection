# 1.0 Beta 6.1

Fixed a memory leak in the activity log that could freeze the app and use excessive RAM and swap space on Tahoe. This is Beta 6 with only the memory leak fix.

Published the source code after a user pointed out that it wasn't available.

Previous releases were taken down following reports of a memory leak, and for transparency because their source code had not been published.

Corrected the build instructions: the first Beta 6.1 upload reused older compiled helpers, so a fresh source build did not match it. The download now comes directly from the published build script, with byte-for-byte matching clean builds. The source archive and checksums have been updated too. The app's code changes remain limited to the memory leak fix; it does not include Beta 7 changes.

The version shown inside the app still says Beta 6 (build 105). The earlier memory-fix package passed installation testing; this rebuild passed reproducibility and targeted checks, but has not had another full installation test.
