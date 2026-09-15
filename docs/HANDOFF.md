# Engineering Handoff — SmartPaste

## Purpose

SmartPaste grew from a paste/location helper into an integration component used for durable navigation between Obsidian content and external study/workflow tools. This handoff records the identity model, navigation fixes, compatibility constraints, testing and release process.

## Core problem

A file path alone is not a stable enough return target when content moves inside a note. SmartPaste therefore assigns durable block identities (`smartpasteblockID-<hex>`) and provides protocol/location handling so external tools can return to the intended content rather than merely opening the note.

## Block identity and visibility

SmartPaste block IDs are persisted in Markdown so they survive application restarts and can be addressed externally. They are hidden in Live Preview for normal reading while Source mode continues to show the raw identifier. Visibility behavior is implemented separately under `src/block-id-visibility.js` and is covered by tests.

## Navigation protocol

The plugin handles `obsidian://smartpaste` navigation. Protocol parsing/target selection/navigation are separated under `src/protocol-target.js` and `src/protocol-navigation.js`. Navigation includes a highlight layer so successful return is visible to the user.

A major integration lesson was that “Obsidian opened the note” is not sufficient acceptance. Exact-block return must be verified. The integration path was updated until external return opened the correct note **and** the correct block.

## Location association conflict fix

During Anki/Obsidian integration, stale Knowledge-tree/file association could mask the actual Review location. The accepted rule became: when the logical identity is the same, the explicit/current location wins; genuinely conflicting locations fail rather than silently choosing one; legacy file-only associations remain supported. This prevents a stale association from sending the user to the wrong place.

## Removal/commands

The plugin includes explicit location-removal/editor commands and command-palette integration. Deleting an association must remove only the intended SmartPaste metadata and preserve unrelated note content.

## Integration boundary

`docs/integration.md` is the primary integration contract. SmartPaste should not contain private assumptions about one local vault path or Anki database. External companions may store/use SmartPaste identities, but protocol compatibility must remain versioned/tested from public fixtures.

## Build and reproducibility

Source lives under `src/`; `scripts/build.js` creates the distributed `main.js`. `scripts/reproducibility.cjs` and publication tooling verify that publication artifacts correspond to the accepted source. Do not hand-edit built output without updating/rebuilding the source path.

## Testing

The repository contains focused tests for block-ID visibility, command palette, compatibility, protocol/location behavior and publication. CI runs from `.github/workflows/ci.yml`. Integration acceptance should additionally exercise a real Obsidian instance when changing protocol navigation because unit tests cannot prove editor scrolling/rendering behavior.

## Releases

The public line reached **0.6.0** after exact-block navigation and coordinated integration work. The release workflow and publication manifests define the distributed files. `CHANGELOG.md`, `docs/release-notes.md`, `docs/releases.md` and `docs/validation.md` are the release evidence set.

## Repository map

- `README.md` — public feature/usage documentation.
- `docs/integration.md` — external integration contract.
- `docs/validation.md` — validation evidence.
- `docs/releases.md` / `docs/release-notes.md` — publication history.
- `src/` — maintainable source modules.
- `main.js` — built plugin artifact.
- `tests/` — regression/compatibility/publication tests.
- `publication*.json` — release ownership/metadata.
- `.github/workflows/` — CI and release automation.

## Maintenance rules

For identity/navigation changes: preserve backward compatibility fixtures; test same-identity/current-location precedence; test true conflict refusal; test legacy file-only data; test protocol parsing; test exact block return in real Obsidian; rebuild deterministically; run publication checks; update changelog/validation/handoff.

## Historical integrity rule

Do not reduce acceptance to “note opened.” The exact-block bug is part of the reason the current architecture exists. Keep file identity, block identity and current location as distinct concepts and fail ambiguous conflicts explicitly.

## Current handoff status

As of 2026-09-15, SmartPaste has source/build separation, extensive tests, CI/release automation, third-party notices, integration/release/validation documentation and this handoff. Public 0.6.0 is the accepted integration baseline documented by the project history.