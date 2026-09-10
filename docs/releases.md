# Maintaining releases

1. Develop on a branch. For SmartPaste, edit src/ and regenerate main.js; for DesignTweaker, edit authored main.js/styles.css.
2. Set the next bare x.y.z version in manifest.json, package.json, package-lock.json and its root package entry. Update versions.json with the new version/minAppVersion. Keep the plugin ID unchanged.
3. Review README compatibility and migration notes. Update docs/release-notes.md. Add new public source files to publication-files.json only after reviewing their contents. Review digest-bound parser findings if the generated bundle changes.
4. Run `npm ci --ignore-scripts` and `npm run verify`. Review the exact three-file artifact directory, checksums, tests, license notices and Git diff. Commit the coherent source/metadata/output changes normally.
5. Only after release authorization, tag the approved default-branch commit with the exact bare manifest version and push that tag. Do not use a v prefix. The workflow validates the tag and default-branch ancestry, reruns checks and creates a new draft release. It refuses to overwrite an existing release.
6. Inspect the draft's individual main.js, manifest.json and styles.css assets before publishing. Once published, test manual installation and BRAT update in a disposable vault before announcing it. Never replace user data.json or silently overwrite a distributed release; make a new version instead.

CI has read-only contents permissions. Only the draft job has write access, and the release token is supplied only to its final upload step. Actions are pinned to reviewed immutable commits. Node is pinned to the locally validated baseline. Dependency lifecycle scripts are disabled during installation; esbuild's platform package is supplied by the lockfile.

References: [Obsidian releases](https://docs.obsidian.md/plugins/releasing/submit-plugin), [versions mapping](https://docs.obsidian.md/Reference/Versions), [BRAT](https://github.com/TfTHacker/obsidian42-brat).
