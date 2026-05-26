---
title: CLI
description: Every CodeGraph command and the flags it accepts.
---

```bash
codegraph                         # Run interactive installer
codegraph install                 # Run installer (explicit)
codegraph uninstall               # Remove CodeGraph from your agents (inverse of install)
codegraph init [path]             # Initialize in a project (--index to also index)
codegraph uninit [path]           # Remove CodeGraph from a project (--force to skip prompt)
codegraph index [path]            # Full index (--force to re-index, --quiet for less output)
codegraph sync [path]             # Incremental update
codegraph status [path]           # Show statistics
codegraph query <search>          # Search symbols (--kind, --limit, --json)
codegraph files [path]            # Show file structure (--format, --filter, --max-depth, --json)
codegraph context <task>          # Build context for AI (--format, --max-nodes)
codegraph callers <symbol>        # Find what calls a function/method (--limit, --json)
codegraph callees <symbol>        # Find what a function/method calls (--limit, --json)
codegraph impact <symbol>         # Analyze what code is affected by changing a symbol (--depth, --json)
codegraph affected [files...]     # Find test files affected by changes
codegraph serve --mcp             # Start MCP server
codegraph vr [path]               # Start WebXR/VR graph viewer (--quest, --git4d, --tls-cert/--tls-key)
```

## Query commands

`query`, `callers`, `callees`, and `impact` all accept `--json` for machine-readable output.

```bash
codegraph query UserService --kind class --limit 10
codegraph callers handleRequest --json
codegraph impact AuthMiddleware --depth 3
```

## affected

Traces import dependencies transitively to find which test files are affected by changed source files. See [Affected Tests in CI](/codegraph/guides/affected-tests/) for options and a CI example.

## vr

Starts a local WebGL/WebXR graph viewer for desktop browsers, Quest 2+ headsets, and Virtual Desktop workflows. It reads the CodeGraph index and links `git4d-results/kamui4d-graph.json` when present.

```bash
codegraph vr . --quest
codegraph vr . --host 127.0.0.1 --port 8734
codegraph vr . --git4d git4d-results/kamui4d-graph.json
```

`--quest` binds to `0.0.0.0` and prints a LAN URL. Immersive WebXR requires a secure context; `localhost` is suitable through Virtual Desktop, while standalone headset browsers may need `--tls-cert` and `--tls-key`.
