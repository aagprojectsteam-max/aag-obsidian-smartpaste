# AAG - Smart Paste 0.6.1

This release hardens asynchronous paste handling and HTML conversion while preserving the existing SmartPaste workflow.

- Aborts asynchronous paste if the target editor/file/selection changed while clipboard access was pending.
- Replaces fragile paragraph-tag rewriting with DOM-aware HTML transformation.
- Preserves paragraph and line-break boundaries when converting small text to braces.
- Scopes SmartPaste formatting CSS to SmartPaste-owned output.
- Adds browser-based regression coverage for active/unsupported HTML sanitization.
- Keeps the existing precise-location and optional local Anki Bridge integration behavior.

Requires Obsidian 1.13.7 or newer. AAG-owned code remains MIT; bundled third-party license notices are retained.

## Release asset SHA256

| Asset | SHA256 |
| --- | --- |
| main.js | `6ed33beefe2c6e17079b3a6d6af9d3f29fc4362f25e39d9f62bcfabc882c22c6` |
| manifest.json | `de6f33460053ebb6e342ab4324ffd9dd478420685bfa06c6cc8e1553d95004c0` |
| styles.css | `d4209fa1a67b69773650a11922aa7dbb5bfe63162de0833f23833d08af486ab1` |
