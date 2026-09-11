# Changelog

## 0.6.0

Adds the optional **Associate current location with Anki** command through the existing AAG Anki Bridge API. It creates or reuses a stable block ID, saves and verifies the note, then opens the bridge confirmation for a specific Anki target. SmartPaste does not manage Anki profiles, databases or transports.

Requires an already installed compatible private AAG Anki Bridge 0.2.0 and the coordinated AnkiSuit checkpoint. Those components are not included in this public release and are not currently cleared for public redistribution. If a compatible bridge is unavailable, the command reports that prerequisite before editing. All standalone paste, copy-link and location-point commands remain available.

Fixes exact-block navigation when an existing tab-management plugin, such as Opener, redirects a closed-note open into another tab. Navigation follows the exact requested file, validates indexed block/editor content and waits briefly for readiness. Missing/unsafe/unknown locations still fail explicitly; no file-only downgrade occurs.

Linux acceptance covers real create/save/return, open and closed notes, a far previous cursor, explicit replacement of file-only associations, stable-ID reuse and preservation of existing anchored associations. The coordinated production path preserves existing GNOME Run-or-Raise activation, workspace switching and focus. No bulk association migration is performed.

Requires Obsidian 1.13.7 or newer. AAG-owned code remains MIT; bundled third-party licenses and notices remain intact.

## 0.5.1

Initial public licensed package and validated release tooling.
