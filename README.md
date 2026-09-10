# AAG - Smart Paste

Paste selected HTML formatting, clean up selected text, and create stable external links to Markdown blocks in Obsidian.

## Commands

| Command | Behavior |
|---|---|
| Paste HTML With Font Sizes | Keeps supported inline font size, alignment and direction while removing other HTML attributes. |
| Paste Small Text As Braces | Converts HTML `<small>` content to `{text}`. |
| Paste Small Text As Colors | Converts HTML `<small>` content to blue text. |
| Replace [] With () In Selection | Replaces square brackets with parentheses in the selection. |
| העתק קישור חיצוני למיקום הנוכחי | Copies an external link to the current block/location. |
| מחק נקודת הפניה של SmartPaste מהפסקה | Removes an eligible SmartPaste location point after confirmation. |

The paste commands read clipboard HTML and fall back to plain text. They also replace square brackets with parentheses. There is no automatic paste interception, RTF reader or settings panel. Assign shortcuts in **Settings → Hotkeys**. Commands remain visible with sidebar/command-palette focus and use the active editor or the most recent visible main note. An unavailable editing context produces a notice without editing.

## Usage

### Paste and selection cleanup

Place the cursor in a Markdown editor, copy supported text/HTML, and run a paste command. For bracket cleanup, select the text and run the selection command. Clipboard support depends on the operating system and browser permissions.

### Copy a location link

In Source mode or Live Preview, place the cursor inside a supported block and run **העתק קישור חיצוני למיקום הנוכחי**. The command reuses an existing unambiguous native block ID or inserts a new `^smartpasteblockID-` followed by 16 lowercase hexadecimal characters. It saves and verifies the note before copying the link. Repeated commands reuse the same anchor.

A synthetic example:

```text
obsidian://smartpaste?vault=Example%20Vault&file=folder%2Fnote.md&block=smartpasteblockID-7f3c92d8e104ab56
```

The URI contains the vault name, relative note path and block ID. Share links only when you intend to disclose that information. Rename/move operations or removing an anchor can invalidate existing links. A clipboard failure leaves a newly saved anchor available for retry; a save failure is reported separately.

### Visibility and external navigation

Live Preview hides only IDs in the exact current SmartPaste format and its legacy `^aag-` plus 16-hex format, together with their inserted separator/dedicated line where recognized. The Markdown retains the ID; **Source mode reveals it**. Reading View uses Obsidian's native block rendering. Other plugins' IDs are not hidden by this extension.

Following a new link invokes SmartPaste in the target vault and navigates to the beginning of the block's editable content. The plugin must be enabled in that vault. Navigation does not edit Markdown. Older native `obsidian://open` links continue to use Obsidian's behavior and native highlight; copying a link again generates the custom protocol form without changing an existing ID. Advanced URI is not required.

### Remove a location point

Run **מחק נקודת הפניה של SmartPaste מהפסקה** at the target block. The confirmation explains that existing links to that anchor will stop resolving. Only the exact current `smartpasteblockID-` plus 16 lowercase hex digits is removable. Legacy/user/third-party IDs remain intact. Cancellation leaves the note unchanged; editor Undo can restore an anchor after removal.

## Limitations and compatibility

Ordinary paragraphs, Hebrew/RTL text and simple list/task items are supported. Quotes, callouts and tables are linked as whole blocks, not individual cells. Headings, code, frontmatter, math, HTML, ambiguous IDs and unfamiliar structures may be declined. Unknown plugin metadata is preserved rather than rewritten. Unsaved/divergent content, multiple selections or unsafe whitespace conditions can also be declined; save and retry.

The parser uses editor text and conservative guards, not arbitrary third-party decorations. Tests cover synthetic compatibility cases; they do not certify every third-party plugin. Source mode and Live Preview are editing targets; Reading View is not. The manifest permits mobile, but mobile clipboard and OS URI dispatch have not been independently verified. Desktop parser compatibility is checked against 1.13.7; full desktop/mobile GUI acceptance remains an explicit limitation.

If navigation fails, check the vault/file name, ID, enabled plugin and whether the note was moved. If insertion is declined, try an ordinary saved paragraph and inspect Source mode for metadata. Do not remove another plugin's markers to force insertion.

## Installation

Requires Obsidian **1.13.7 or newer**. This first public package uses a conservative minimum host version; older versions are not claimed as supported. The plugin has no account or subscription requirement.

### Manual installation

1. Open this repository's **Releases** page and choose a published release.
2. Download the individual `main.js`, `manifest.json` and `styles.css` assets, not the automatic source archive.
3. Create `<vault>/.obsidian/plugins/aag-smart-paste/` and copy those three files into it.
4. Enable community plugins in Obsidian, then enable **AAG - Smart Paste**.

Until a release is published, build the source as described below to obtain the same files.

### BRAT

Install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat). Run its **Add a beta plugin for testing** command, paste this repository's GitHub URL, and add the plugin. Enable it in Community plugins. BRAT requires a published GitHub release with the plugin assets; local preparation alone is not an end-to-end BRAT installation test.

## Updating

Use BRAT's update command, or replace only the three runtime files from a newer release. Preserve your existing settings and vault notes. Disable/re-enable the plugin or restart Obsidian after a manual update. The plugin ID is stable, so the installation directory stays the same. Older Obsidian users should keep their current installation until they can upgrade the host. The compatibility map contains only published-version candidates from this repository, not unavailable historical releases.

## Development

Use Node.js **22.22.1** (CI baseline) or a compatible newer Node 22+ installation, and npm.

```sh
npm ci --ignore-scripts
npm run verify
```

`verify` runs manifest/package/versions checks, JavaScript syntax checks, the build, tests, exact release-asset validation and a redacted privacy/secret-pattern scan. This project uses JavaScript; syntax validation is not a TypeScript typecheck. `dist/release/` contains exactly `main.js`, `manifest.json` and `styles.css`; its checksums are printed by the staging command. Do not add local settings or install dependencies inside a release package.

```sh
npm run check
npm test
npm run build
npm run release:stage
npm run release:check
npm run scan
```

See [validation and compatibility](docs/validation.md) for the limits of automated tests and [release maintenance](docs/releases.md) for the release process.

## Troubleshooting and issues

Confirm the plugin files are in the directory matching the manifest ID and that the host meets the minimum version. Reload the plugin after updating. For a reproducible problem, open an issue using this repository's **Issues** tab with the plugin/Obsidian versions, operating system, view mode and a minimal synthetic example. Do not include private vault notes, settings exports, usernames, access tokens or diagnostic captures containing personal data.

## License

AAG-owned code is licensed under [MIT](LICENSE). Obsidian is a separately supplied host application, not distributed by this repository.

The authored entry is `src/main.js`; root `main.js` is generated and committed. Never hand-edit the generated bundle. The build bundles the Markdown parser and preserves dependency licenses. Obsidian/CodeMirror remain host-provided imports. Build before running the suite after source changes. `npm run reproducibility` verifies a byte-identical rebuild.

All pre-existing behavioral tests are retained. Optional native-parser tests require an independently installed Obsidian archive; see the validation guide. No proprietary Obsidian code is included. [Third-party notices](THIRD_PARTY_NOTICES.md) cover bundled dependencies and distinguish development/host dependencies from AAG code.
