# Official upstream synchronization — 2026-10-23

## Overview and requirements

Goal: integrate the latest official CodeGraph features, fixes and security updates using Python, retaining the fork's VR/AR viewer, Git4D bridge, static Pages export, opt-in telemetry and fork release configuration. Validate these features against the current official API, rather than retaining obsolete upstream implementations.

Requirement IDs: SYNC-1 = exact latest upstream target; FORK-1 = retained VR/AR, Git4D and static export; FORK-2 = explicit telemetry opt-in plus upstream live opt-out; TOOL-1 = repeatable Python no-commit merge; QA-1 = current build, functional tests and dependency audit.

## Baseline and sources

- Initial HEAD: `9a4517eea57b9ac375cf097de407565c03ef02db`, branch `codex/vr-ar-pages-20260815`.
- Official remote: `https://github.com/colbymchenry/codegraph.git`; fork: `https://github.com/zapabob/codegraph.git`.
- Session began with an unresolved automatic merge of `89cd08fab80fdf443d2851a7721fea286a9ea2d0`, with 13 conflicted paths. `git diff AUTO_MERGE` was empty; staged differences from AUTO_MERGE were exactly the conflict paths. There was no user work after the automatic merge.
- Fetched official target: `9ed79c6cf1a93e76ad4d1b9846f582701c7e8373` (2026-10-22T17:04:12Z), verified through Git and the GitHub commits API. The merge base is `c6aaa20358cd6adcd04b87bdef8e5803ad146f3a`; the branch is 6 commits ahead and 759 behind this official target before the merge.
- Final upstream refresh found three further commits at `08478eea5323ce43ef7650e4968fa03a07fda6fa` (2026-10-22T18:11:37Z): JS/TS receiver-binding scope, nested Delphi routines and removal of an unused extraction hook. This final target is pinned for the last integration/verification pass instead of discarding the resolved initial merge.
- Latest published official release checked: [v1.6.2](https://github.com/colbymchenry/codegraph/releases/tag/v1.6.2), published 2026-10-03. The target also includes subsequent unreleased main-branch work.
- Public repository advisory API returned zero published advisories for CodeGraph on this check. This does not establish absence of vulnerabilities.
- [Vitest 4 migration](https://v4.vitest.dev/guide/migration.html): projects replace workspace discovery; fork execArgv moves out of poolOptions.
- [Vitest advisory GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9), CVE-2026-84373, published 2026-09-08: patched in 4.1.11.
- [Vitest advisory GHSA-qxg6-89mg-rqv8](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8), CVE-2026-112949, published 2026-10-21: patched in 4.1.12.
- [source-map-js advisory GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), CVE-2026-93749: patched in [1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2).
- npm registry metadata confirmed repository, engine, integrity and peer requirements for adopted packages; Vitest 4.1.12 advertises npm provenance. No general supply-chain certification or exploitation-status claim is made.
- Separate site audit found 13 vulnerable dependency packages, including Astro and sharp; telemetry worker/dashboard locks also contain vulnerable development dependencies. These are separate dependency trees, not covered by the root workspace audit.
- [Astro 7 migration](https://docs.astro.build/en/guides/upgrade-to/v7/) and the [Starlight changelog](https://github.com/withastro/starlight/blob/main/packages/starlight/CHANGELOG.md) document the paired upgrade, Markdown processor and whitespace changes. Preserve the existing unified Markdown pipeline and `compressHTML: true`.
- [Astro GHSA-26w7-cxv4-gfx2](https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2) is patched in 7.2.8; [GHSA-98hj-9722-w3j8](https://github.com/withastro/astro/security/advisories/GHSA-98hj-9722-w3j8), published 2026-10-22, is patched in 7.3.2. [sharp GHSA-wq5f-xc86-pv6w](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w) is patched in 0.35.5.

## Applied standards and decisions

Applied the PC engineering baseline and canonical pre-implementation context, compatible with the active harness. SOPs: Common, Implementation Start Gate, Skill Selection, DeepResearch, Security, Application Development, WebApp Development, Frontend Design, Python and TypeScript. Skills: deepresearch-defense-standard, milspec-codex-standard, plan-mode, conflict-prevention-engine and completion/QA self-review. Existing project instructions, code, tests, README and telemetry documentation were inspected. UI work preserves existing visual design; no new design tokens were introduced. No subagents were used.

Use the existing Python driver, pin the commit SHA, retain explicit conflicts and leave the merge uncommitted. Restart the untouched stale automatic merge only after checking HEAD/ORIG_HEAD, AUTO_MERGE, index and untracked state. A temporary Python wrapper delegates the new apply operation to the repository's driver; its report is `C:/Users/downl/AppData/Local/Temp/opencode/codegraph-upstream-merge-20261023.json`.

Node on the default PATH is 26.10.0, outside this project's engine range. Validation uses the existing `C:/Users/downl/AppData/Local/nvm/v22.23.2/node.exe`. uv is installed at `C:/Users/downl/.local/bin/uv.exe` but absent from PATH; Python commands use that uv and the installed Python 3.12.10 interpreter. No global tool installation or configuration change is required.

## Implementation

- Merge all official changes through the final target, including the bundled Node runtime and grammar-check crash/hang fixes, JS/TS receiver-binding improvements, Delphi nested routines and extraction-hook cleanup.
- Resolve CLI and site documentation conflicts by retaining both `vr` and the gated official `ui` command.
- Retain Windows CRLF parsing and database/child-process cleanup, adopting equivalent or more complete official fixes and preserving the fork's additional SQLite connection close calls.
- Merge upstream telemetry identity reset, cross-process consent rechecks and in-flight chunk guards with the fork's default-off, explicit-consent and temporary environment-override behavior. Update newly added transport tests to opt in explicitly.
- Preserve bounded visualization snapshot access, custom MCP tool allowlisting, viewer assets, Git4D linking, static privacy filtering, Pages site identity and fork release token fallback.
- Keep patched Vitest 4 instead of downgrading to official Vitest 2; migrate projects and WASM runtime flags to the supported Vitest 4 configuration. Align the Svelte plugin with the existing UI workspace's Vite-compatible version.
- Extend `scripts/merge_official_upstream.py` with fetch, SHA-pinned apply, merge forecast error handling and structural verification. Verification checks the pending/committed target, unresolved paths, missing fork-exclusive files and whitespace, allowing CRLF while rejecting trailing spaces. It is not a substitute for functional tests.
- Add isolated Git repository tests for the Python merge driver and real SQLite/MCP/CLI integration tests for the fork's VR entry points.
- Upgrade the separate site to Astro 7.4.2, matching Starlight 0.42.6, markdown-remark 7.3.4 and sharp 0.35.5 based on official advisory and registry metadata. This is a major site-toolchain upgrade required to leave the affected Astro line, not an engine runtime change. The site declares Astro's `>=22.23.4` minimum. Its successful install/build used the existing system Node 26.10.0, which meets that site's requirement; core engine validation uses supported Node 22.23.2.
- Old site node_modules retained Starlight 0.39.2's Astro 6 peer and blocked the major upgrade even after removing the old lockfile. Move only that generated dependency directory into the approved temp directory, then regenerate the lock from the declared, compatible Astro/Starlight pair without force/legacy peer flags. A Codex-managed Node 24 runtime changed cache directories during validation and later failed npm file writing with EBADF; use the stable system runtime for the independent site build. No runtime was installed or global configuration changed.
- Refresh the telemetry-worker and telemetry-dashboard locks to patched compatible Wrangler 4.152.0 dependency trees. Both local checks run with an isolated temporary HOME and metrics disabled. The dashboard's documented placeholder `.dev.vars` prerequisite was temporarily supplied for type generation and removed afterward; no real credentials or remote deployment were used.
- Add `--advance` to the Python merge driver for descendant updates during a pending merge. Require reviewed staged content, apply a raw binary-safe three-way Git patch, preserve existing resolutions, and update Git's pending parent only after complete patch success. Git refuses `update-ref MERGE_HEAD` because it is a pseudoref; an exclusive owned lock plus atomic replacement updates that generated merge-state file without making a commit. Eleven isolated Git tests cover this operation, including conflicts, binary updates, unreviewed edits and another operation's lock.

One intermediate commentary incorrectly inferred asynchronous project retrieval from an `await` call site. The actual current `getCodeGraph` declaration returns CodeGraph synchronously. That inference was corrected and the unnecessary code change reverted; the integration test exercises the real lifecycle API.

## Changed files

The final incoming merge spans 1,150 official changed paths (762 official commits after the shared base). Fork integration work touches the conflicted CLI/docs/tests/telemetry/configuration, root package manifest/lockfile, Python driver and tests, VR integration tests, `.gitignore`, site manifest/lock/configuration/README, both telemetry service lockfiles, and `_docs` evidence. The root AGENTS correction documents only the supported Vitest configuration and preserves its existing isolation controls.

## Commands and verification

- `git fetch upstream`, official GitHub repository/release/commit/advisory API checks: completed.
- Temporary Python restart wrapper via uv, delegating to `merge_official_upstream.py --apply` with the initial full pinned SHA: succeeded. Then `merge_official_upstream.py --upstream-ref 08478eea5323ce43ef7650e4968fa03a07fda6fa --advance --report _docs/2026-10-23_merge-advance.json` succeeded, preserving the resolved fork changes and advancing MERGE_HEAD to the final target. The resulting two-parent merge commit is `531f7fa652ee52f21fe38a5164e20b426971541a`, with first parent `9a4517ee` and official second parent `08478eea`.
- `npm install --package-lock-only --ignore-scripts`, followed by compatible `npm audit fix --package-lock-only --ignore-scripts`: resolved the conflicted lockfile, upgraded Vitest/mocker and source-map-js; audit reported 0 vulnerabilities.
- `npm ci --ignore-scripts --no-fund`: 173 packages installed; audit reported 0 vulnerabilities.
- `tsc --noEmit`: passed before dependency reinstall. After reinstall, direct `tsc --extendedDiagnostics` passed, compiling 494 files with strict project checks in 115.11 seconds.
- `npm run copy-assets` and `npm run build:ui`: passed; 532 viewer modules built and asset checks confirmed the viewer, 29 vendored grammars and intact engine output.
- A combined `npm run build` exceeded a 300-second tool timeout. Its individual TypeScript/assets/viewer steps subsequently passed, including fresh automatic builds before the final upstream tests. The combined timed-out invocation is not counted as a successful command.
- Python tests initially timed out loading unrelated globally installed pytest plugins. With `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, fixture identity isolation and CRLF handling issues became visible and were corrected. The final merge-driver suite passed 11 tests in 91.67 seconds; black and flake8 checks subsequently passed on both delivered Python files.
- A short-lived Windows PowerShell loader failure (`0x800705AF`) prevented some parallel commands from starting; these did not execute and were retried sequentially. Current free memory was checked after resuming.
- Fork compatibility Vitest run: 7 files / 60 tests passed, including real SQLite snapshot, MCP launch/path-boundary, built CLI static export, telemetry and viewer-gate checks; JSON evidence is `2026-10-23_fork-compatibility-tests.json`.
- The structural whitespace check initially detected unchanged upstream whitespace, including required blank context lines inside grammar patch files. Its final scope is the fork's delta against the pinned upstream target, retaining CRLF handling and explicit trailing-space rejection; the updated regression suite passed.
- Conflict-area regression run: 9 files, 656 passed / 37 platform-gated skips, no failures (`2026-10-23_regression-tests.json`). Covers resolution, installer targets, framework integration, MCP daemon/initialize/roots, security boundaries and both conflicted explore suites.
- Official update/UI run: 7 files, 111 passed / 5 platform-gated skips, no failures (`2026-10-23_official-update-tests.json`). Includes actual Svelte package mounts in the UI project, UI server, telemetry services, recent launcher/grammar fixes, build freshness and home sandbox isolation.
- Final target run: 9 files / 273 passed, no failures or skips (`2026-10-23_final-upstream-tests.json`). Re-ran all 236 resolution tests plus VR integration/export after the latest core changes, and covered all three late upstream changes and TS method controls.
- Together these runs cover 28 distinct Vitest files and 858 distinct passing cases, with 42 platform-gated skips. There are 1,100 successful executions including reruns of resolution and VR tests; do not report those reruns as extra distinct coverage.
- `npm run build:lib`: passed; package seam check validated 171 files, 114 rewritten imports and 9 pruned application-only modules. It remains private and is not published.
- Site `npm ci --ignore-scripts --no-fund --prefix site` and `npm run build --prefix site` on system Node 26.10.0: passed. Astro 7.4.2 built 22 pages, indexed 23 HTML files for search and generated the sitemap. Warnings concern the empty optional i18n collection and absent custom 404 entry; the 404 page still builds.
- Site Chromium smoke verification via the installed Python Playwright, using only a loopback static server: 8/8 passed. Desktop/mobile home, spatial page, CLI docs and WebGL viewer render without console errors, failed assets or horizontal overflow. Checked both CLI sections, mobile menu, keyboard focus, lazy-loaded images, VR/AR controls and graph interaction. JSON plus eight screenshots are in `2026-10-23_site-browser/`; spatial desktop/mobile, viewer and CLI mobile screenshots were visually reviewed. The native browser toolset required by the dogfood skill is unavailable, so its verification principles were applied through this installed Playwright fallback.
- `npm run check --prefix telemetry-worker` and `npm run check --prefix telemetry-dashboard`: passed with Wrangler 4.152.0 (runtime types, strict type checks, assets and deploy dry-run). The first dashboard type check exposed its documented missing placeholder-secret prerequisite; supplying the example placeholders made the check pass, and the temporary `.dev.vars` was removed. All execution was local-only.
- Final lockfile audits for root + UI, site, telemetry-worker and telemetry-dashboard all returned exit 0 and zero vulnerabilities, including development and optional dependencies (`2026-10-23_dependency-audit.json`). Their package trees were not changed by the final three upstream commits.
- `git diff --exit-code 08478eea5323ce43ef7650e4968fa03a07fda6fa --` over the nine non-changelog paths in the late upstream update passed: these official changes are byte-equivalent through Git's normal text filters. Final Python structural verification and staged-state check are recorded in `2026-10-23_merge-verification.json`.

## Traceability and residual risks

SYNC-1 is checked through full Git/GitHub SHA agreement; TOOL-1 through isolated Git fixtures; FORK-1 through bounded SQLite snapshot, MCP launch/path-boundary and built CLI static-export tests; FORK-2 through consent/transport/live opt-out tests; QA-1 through build, audit and relevant regression suites.

Physical Quest/headset immersion, Linux/macOS runtime behavior, Rust kernel rebuilding and the entire repository-wide Vitest suite were not run in this Windows session. The scoped 28-file regression set covers integration conflicts, custom entry points, official core delta, toolchain migration and primary trust boundaries; language/platform cases outside it remain a residual risk. Existing static demo data is preserved rather than regenerated from local private sources. No formal standards compliance or absence of undisclosed vulnerabilities is claimed.

## Self-review and next actions

Self-review-event: qa_defect — transient environment failures and early fixture verification failures were observed. Retain the actual failure evidence and require fresh successful reruns; never mark unexecuted checks as passed. Use isolated pytest plugins and Git identity/config in fixtures, and validate CRLF without weakening real whitespace checks. Review-only governance response; no PC-wide instructions or skills are changed.

Self-review-event: ticket_completed — the final target and custom entry points have fresh successful verification. The late-upstream update justified re-running resolution/VR tests; unrelated previously passing suites were not repeatedly rerun. Pseudoref-update rejection was caught in a disposable Git fixture before use in the real worktree. Its replacement preserves another operation's lock and never updates ancestry for a failed patch, as tested. Rejected alternatives: discarding existing conflict resolutions, force/legacy-peer dependency installation, silently ignoring failed checks, weakening consent, automatic publication, and speculative PC-wide governance edits.

## Handoff and reproduction

The merge was committed as `531f7fa652ee52f21fe38a5164e20b426971541a`. The clean local `main` worktree at `C:/Users/downl/Documents/New project/codegraph` was fast-forwarded to it, then `origin/main` was pushed successfully (`9a4517ee..531f7fa6`). No release or production deployment was performed. For future updates, use the driver's default plan/`--fetch`, then `--apply` from a clean worktree; `--advance` accepts only reviewed staged merges and descendant upstream updates. `--verify` is the structural check; retain the functional regression gates above.

Example local verification (uv is not on this machine's PATH):

```powershell
& "C:\Users\downl\.local\bin\uv.exe" run --no-project --python "C:\Users\downl\AppData\Local\Programs\Python\Python312\python.exe" python -B scripts/merge_official_upstream.py --upstream-ref 08478eea5323ce43ef7650e4968fa03a07fda6fa --verify
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD = '1'
& "C:\Users\downl\.local\bin\uv.exe" run --no-project --python "C:\Users\downl\AppData\Local\Programs\Python\Python312\python.exe" python -B -m pytest scripts/tests/test_merge_official_upstream.py -q -p no:cacheprovider
```

Recommended next action: re-index a working project's index when adopting the extraction/resolution improvements, as the official changelog requests; no existing user index was rebuilt by this synchronization task.
