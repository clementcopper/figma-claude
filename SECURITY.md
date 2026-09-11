# Security Policy

## Reporting a vulnerability

Report privately, not through the public issue tracker.

- **Preferred:** [GitHub private vulnerability reporting](https://github.com/silships/figma-cli/security/advisories/new). It is enabled on this repository and gives you a private thread plus a CVE path if one is warranted.
- **Email:** sil@intodesignsystems.com

Useful in a report: what you did, what happened, which version (`figma-cli --version`), your OS, and which connection mode you were in (Yolo, Browser or Safe).

### What to expect

| Step | Timeframe |
|---|---|
| Acknowledgement that the report arrived | within 3 working days |
| First assessment, whether it is reproducible and how severe | within 7 working days |
| Fix released, or an explanation why it will not be | depends on severity, communicated in the thread |

This is a solo-maintained project, so those are honest targets, not a contractual SLA. If you get no answer within a week, send a reminder to the address above.

Please give me a chance to ship a fix before you publish. Credit in the release notes if you want it.

## Supported versions

Fixes go into the latest release on npm (`figma-ds-cli`). Older versions are not backported.

## What this tool does to your machine

Security review of figma-cli is mostly a question of what the three connection modes touch, so here it is in full. This is also the section to point at when a company asks before approving the tool.

### Yolo Mode (`figma-cli connect`)

- **Modifies the Figma Desktop app.** It rewrites one string in Figma's `app.asar` (`removeSwitch("remote-debugging-port")` becomes `removeSwitch("remote-debugXing-port")`), which stops Figma from stripping its own remote-debugging flag. Nothing else in the app is changed, no code is injected.
- Figma then listens for the Chrome DevTools Protocol on **127.0.0.1:9222** (`FIGMA_PORT` overrides). CDP has no authentication, so any local process that can reach that port can drive Figma. Do not expose it beyond localhost.
- A Figma update replaces `app.asar` and reverts the patch. Re-running `connect` re-applies it.
- On macOS this needs the "App Management" permission for your terminal.
- **The patch replaces Figma's code signature.** A modified bundle no longer matches its Developer ID signature, and a quarantined app in that state does not launch: Gatekeeper shows "Figma.app is damaged" (measured on macOS 13 with a fresh download, patched but not re-signed). So `connect` re-signs the bundle ad hoc (`codesign --force --deep --sign -`). After that, `codesign -dv /Applications/Figma.app` reports `Signature=adhoc` and no team identifier; Figma's own signature and its notarization are gone until the next Figma update or a reinstall. `figma-cli unpatch` restores the one string in `app.asar` byte for byte, but it cannot restore the signature. An endpoint-security or MDM tool that checks whether installed apps still carry their vendor signature will flag a patched Figma. That is the compliance cost of Yolo Mode; Safe Mode has none of it.

### Browser Mode (`figma-cli connect --browser`)

- **Does not touch the Figma Desktop app.** It launches Chrome/Edge/Brave/Chromium with remote debugging on the same local port, using a dedicated persistent profile so your everyday browser profile and its cookies stay separate.
- Same caveat as above: the CDP port is unauthenticated and local. Web pages in that browser cannot reach it: Chromium refuses a debug-socket handshake that carries a page's `Origin`, and the CLI connects from Node without one. (Until 2026-09-10 the launcher passed `--remote-allow-origins=*`, which lifted that check for every tab; it was never needed.)
- The Figma login lives in that profile's cookie store under `~/.figma-ds-cli/chrome-profile`, protected the way Chromium protects any profile on the platform, nothing more.

### Safe Mode (`figma-cli connect --safe`)

- **Modifies nothing.** Communication goes through a Figma plugin you run yourself from Plugins > Development. Choose this one when patching or a debug port is not acceptable on the machine.
- **In an organization, publish the plugin privately instead of importing it.** The setup above uses *Plugins > Development > Import plugin from manifest*, which is a developer feature on every member's machine. Figma's Organization and Enterprise plans let a member publish a plugin to the organization only: follow the normal publish flow and pick the organization under **Publish to**. Figma does not review such plugins ("Internal plugins don't need to go through the review process"), every member of the organization can then run it from the Tools tab under *From <your organization>*, and it is exempt from the *Only admin-approved plugins* setting ("These settings don't apply to private plugins or widgets published by people in your organization"). Sources: [Create private plugins for an organization](https://help.figma.com/hc/en-us/articles/4404228629655-Create-private-organization-plugins), [Manage plugins and widgets in an organization](https://help.figma.com/hc/en-us/articles/4404228724759-Manage-plugins-and-widgets-in-an-organization). Whether the admin-approval setting also blocks the Development menu is not stated in those articles; the private route does not depend on it. Publish from `plugin/` as it is: `manifest.json` restricts network access to `ws://127.0.0.1:3456-3460`, which is what an admin reviewing it should see.
- **The plugin authenticates too.** Its WebSocket handshake (`/plugin?token=…`) carries the same session token as every HTTP request, and a handshake that arrives with a web page's `Origin` is refused even with a valid token — a browser can open a WebSocket to 127.0.0.1 without any CORS preflight, so without this check any open tab could have posed as the plugin and read every command. `connect --safe` prints the token; the plugin stores it in `figma.clientStorage` after the first paste.

### The local daemon

- `src/daemon.js` binds to **127.0.0.1:3456** (`DAEMON_PORT` overrides) and is never exposed to other hosts. It holds the CDP connection so commands don't pay reconnect cost, and it exits after an idle timeout.
- It **executes JavaScript inside the open Figma file**. That is the whole point of `eval` and `render`, and it means the daemon is as trusted as whatever hands it code. If an AI assistant drives the CLI, that assistant can run arbitrary Plugin API code against your file. Treat scripts you did not write the way you treat any other script you are about to run.

### Data and credentials

- No telemetry, no analytics, no phone-home. Outbound requests happen only where a command needs them: `<Icon>` fetches the SVG from the Iconify API, `recreate-url` / `screenshot-url` / Storybook import load the URL you passed, image props load the image URL you passed, and the background-removal command uploads the exported image to remove.bg with your own API key. Nothing leaves the machine on its own.
- **No Figma API key is involved.** The tool never asks for one and never sees your Figma token.
- Credentials for optional plugins (for example a voice API key) go into the macOS Keychain, or on Linux into `~/.config/figma-cli/credentials` with mode 600.

## Scope

In scope: anything in this repository, including the patch mechanism, the daemon, the plugin, and the way command input reaches Figma.

Out of scope: vulnerabilities in Figma Desktop itself (report those to Figma), and the inherent fact that Yolo and Browser mode open an unauthenticated local CDP port, which is documented above and is how the Chrome DevTools Protocol works.
