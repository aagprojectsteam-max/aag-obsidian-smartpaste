# Validation and compatibility

The first public package declares Obsidian 1.13.7 as a conservative supported baseline. Earlier private versions' minimum-version claim is not reused as test evidence. The installed 1.13.7 application archive exposes the host API facilities used by the plugin. No host implementation or archive is distributed here.

Run `npm run verify` with the pinned Node/lockfile toolchain. Publication tests reject missing/corrupt assets, version/ID mismatches, forbidden files, private path/credential patterns and prefixed or mismatched tags. The release directory must contain exactly three byte-identical files. Scans report file/category only and are heuristic checks, not a guarantee against every unknown secret pattern.

UI/theme/OS-specific behavior must be assessed separately. A disposable plugin directory verifies installation layout only; it is not a running Obsidian integration test. The manifest permits mobile, but mobile GUI coverage is not claimed. BRAT end-to-end testing requires a real GitHub release and remains pending until one is explicitly published.

## SmartPaste tests

All behavioral test cases are retained. The fixtures are synthetic; example vault names are not real user data. Tests load source and generated output and exercise anchor safety, command behavior, parser boundaries, failures, URI navigation and rendering-state logic.

Native parser checks are optional in general CI. Set `OBSIDIAN_ASAR` to an independently installed application archive on your machine and run `npm test`. Without that environment variable those six tests are skipped. The release preparation run separately exercised them against Obsidian 1.13.7. They inspect the native worker parser in isolation; they do not launch the app or test a real clipboard, OS URI dispatch or arbitrary third-party plugins.

The generated Markdown parser contains a generic loopback-address pattern as part of URL parsing, not a private endpoint or network connection. The scanner exception is limited to the exact reviewed bundle SHA-256 and category. A different bundle requires review of any repeated scanner finding; do not broadly exclude generated code.
