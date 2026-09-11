# Coordinated location workflow

SmartPaste → AAG Anki Bridge → existing V1 transport → AAG AnkiSuit setter/save/read-back → semantic ACK. The return path resolves the canonical association, invokes the existing Run-or-Raise D-Bus helper, activates the existing Obsidian window/workspace, and sends the exact URI through the same V1 transport for awaited block navigation.

SmartPaste owns stable block-ID creation/reuse and exact URI generation. The bridge owns query/selection and request/ACK transport. AnkiSuit owns active target identity, validation and persistence through its existing setters and save_config. Successful persistence is read back before success is acknowledged. OPENED follows navigation completion; foreground/workspace behavior is separately GUI-validated.

The reported failure had two causes. A Knowledge-tree file-only association masked a newer location-bearing Review association for the same stable node identity. Separately, Opener redirected a closed-note open to a different leaf while the old navigator retained the original leaf.

Canonical resolution: for the same stable identity, one unambiguous location wins over file-only values; conflicting locations fail explicitly. Equivalent representations preserve a deterministic original URI. Labels do not merge unrelated items. Without a location, legacy caller-specific file-only preference remains. No bulk migration or automatic rewriting of old associations occurs.

SmartPaste follows the leaf containing the exact requested file before placing the cursor. Block IDs, encoded anchors and vault/file identity remain intact. Existing location-aware and file-only associations remain supported. Unknown blocks or unsafe targets produce explicit errors without file-only fallback.

The current integration is accepted on Linux/GNOME with the private coordinated companion. Open/closed note, previous cursor, replacement, preservation, exact block visibility, existing window reuse, workspace switching and focus were checked in real applications. This does not establish Windows/macOS/mobile GUI acceptance. AnkiBridge and AnkiSuit remain private pending redistribution rights; the public SmartPaste package contains neither component nor production data.
