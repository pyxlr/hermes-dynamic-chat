# Dynamic Chat

Configurable composer and chat-column widths for Hermes Desktop, inspired by [hermes-codex-skin](https://github.com/FPSUnleashed/hermes-codex-skin).
The plugin works independently of the selected color theme and does not add a sidebar or change colors, typography, borders, or message rendering.

## Current release

The source version is **0.1.0**.
This repository does not yet provide a published release or an automatic updater.
The installable file is [`hermes-dynamic-chat/plugin.js`](hermes-dynamic-chat/plugin.js).

## Usage

Enable **Dynamic Chat** under **Capabilities → Plugins** after installation.
Open the command palette and choose **Dynamic Chat: Composer width** to cycle through the presets.
The command shows the current choice and keeps the palette open for repeated adjustments.

| Preset | Maximum width |
| --- | --- |
| Compact, default | 736 CSS px |
| Wide | 883.2 CSS px, +20% |
| Wider | 1030.4 CSS px, +40% |
| Hermes | Full available chat-pane width |

All presets shrink in narrow panes.
Hermes uses the same width token for the composer and transcript, so both columns stay aligned.
The native dock includes an additional 10 px for its transparent drag margins; the preset describes the visible composer surface rather than that outer dock.
Popped-out composers and HUD layout retain their native dimensions.

The choice persists in the plugin's own local storage and updates other windows through native storage events.
It does not import or change Codex Skin settings.
When both plugins are enabled, Dynamic Chat controls the normal chat width; disabling it restores the remaining theme or plugin's geometry.
Switching themes does not disable Dynamic Chat or reset its width.

## Installation in Hermes Desktop

Copy the `hermes-dynamic-chat` directory to the Desktop application's `desktop-plugins` directory using the platform instructions below.
Use **Reload desktop plugins** from the command palette if discovery has not refreshed, then enable **Dynamic Chat**.
There is no new color-theme entry to select.

Install on the machine running Hermes Desktop, not merely on its connected agent backend.
A Windows Desktop connected to WSL still needs the Windows-side plugin copy.
For custom Desktop homes, use that application's actual home rather than assuming it matches a remote backend's `HERMES_HOME`.

### macOS / Linux

From the repository root, with `HERMES_HOME` set to the local Desktop home when using a custom location:

```sh
plugin_home="${HERMES_HOME:-$HOME/.hermes}/desktop-plugins/hermes-dynamic-chat"
mkdir -p "$plugin_home"
cp hermes-dynamic-chat/plugin.js hermes-dynamic-chat/plugin.yaml "$plugin_home/"
```

### Windows PowerShell

From the repository root, with `HERMES_HOME` set to the native Desktop home when using a custom location:

```powershell
$desktopHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
$pluginHome = Join-Path $desktopHome 'desktop-plugins\hermes-dynamic-chat'
New-Item -ItemType Directory -Force -Path $pluginHome | Out-Null
Copy-Item '.\hermes-dynamic-chat\plugin.js', '.\hermes-dynamic-chat\plugin.yaml' -Destination $pluginHome -Force
```

## Update and uninstall

To update, repeat installation with a newly built plugin and reload desktop plugins if needed.
Saved width settings are retained under the same plugin ID.

To restore the original layout, disable **Dynamic Chat** under **Capabilities → Plugins**.
To uninstall it, disable it first and remove only the `hermes-dynamic-chat` directory from the local Desktop's `desktop-plugins` directory.
The saved preference remains available for a later reinstall.

## Development

Node.js 22 or newer is required to build and test.
There are no build dependencies or runtime packages to install.
Browser tests require Chrome or Chromium; set `CHROME_BIN` if it is not installed at a conventional system path.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
sha256sum -c CHECKSUMS.sha256
```

Use `shasum -a 256 -c CHECKSUMS.sha256` on macOS when `sha256sum` is unavailable.
Edit `src/plugin.js`, not the generated installable file.
The build embeds the complete MIT license and regenerates `CHECKSUMS.sha256`.

Tests cover the shipping ESM, native layout fixtures, pane resizing, theme changes, persistence failures, lifecycle cleanup, and preserved draft inputs.
Two optional compatibility probes load the actual upstream stylesheet through `CODEX_CHAT_COMPAT_CSS`; ordinary builds and tests do not download or depend on the original repository.
These are isolated browser tests, not a claim of activation in a running Desktop window.
See [provenance and design](docs/provenance.md) for source attribution and compatibility boundaries.

## License

[MIT](LICENSE).
The installable plugin includes the upstream copyright and license notice.
