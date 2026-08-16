# Architecture

## How figma-ds-cli Works

```
┌─────────────────┐      Chrome DevTools      ┌─────────────────┐
│  figma-ds-cli   │ ◄────── Protocol ───────► │  Figma Desktop  │
│     (CLI)       │      (localhost:9222)     │                 │
└─────────────────┘                           └─────────────────┘
```

### Technology Stack

1. **Chrome DevTools Protocol (CDP)**: Figma Desktop is an Electron app with a Chromium runtime. We connect via CDP on port 9222.

2. **Own CDP client + daemon**: `src/figma-client.js` speaks CDP directly; `src/daemon.js` keeps that connection alive between CLI calls. (`figma-use` was the original library behind this — it is now only a legacy fallback in `src/index.js` and is broken on Node 20+.)

3. **Figma Plugin API**: We execute JavaScript against the global `figma` object, which provides full access to the Figma Plugin API.

### Connection Flow

1. User runs `figma-ds-cli connect`
2. CLI patches Figma to enable remote debugging (adds `--remote-debugging-port=9222` flag)
3. Figma restarts with debugging enabled
4. CLI connects via WebSocket to `localhost:9222`
5. Commands are executed as JavaScript in Figma's context

### Key Files

```
figma-cli/
├── src/
│   ├── index.js         # Main CLI entry point, all commands
│   ├── figma-client.js  # CDP client, JSX parser, code generator
│   ├── daemon.js        # Persistent server (localhost:3456)
│   ├── figma-patch.js   # app.asar patching
│   ├── platform.js      # macOS/Windows/Linux branching
│   └── blocks/          # Pre-built layouts
├── bin/                 # fig-start, fig-status
├── plugin/              # Safe Mode Figma plugin
├── package.json         # npm package config
├── README.md            # User documentation
└── docs/                # Technical documentation
```

### No API Key Required

Unlike the Figma REST API which requires authentication, we use the Plugin API directly through the desktop app. This means:

- Full read/write access to everything
- No rate limits
- Access to features not available in REST API (like variable modes)
- Works with the user's existing Figma session

### Limitations

- macOS only (for now)
- Requires Figma Desktop (not web)
- One Figma instance at a time
- Some eval commands don't return output (but still execute)
