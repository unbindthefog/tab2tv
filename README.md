# tab2tv

**English** · [Deutsch](README.de.md)

Brave extension that plays the video of a browser tab full screen on a second display (e.g. a TV via AirPlay). The page stays usable on the main display, and its player controls the picture on the TV.

## Installation

`brave://extensions` → turn on **Developer mode** → **Load unpacked** → folder `extension/`. After code changes, click ↻ on the extension's card.

## Settings

- **macOS:** connect the TV via AirPlay as a **separate display**, not mirrored. Leave “Displays have separate Spaces” turned on.
- **Brave:** View → turn off “Always show toolbar in full screen” (⇧⌘F). Settings → Appearance → turn off “Show rounded corners on main elements”.

## Usage

Menu on the extension icon (texts in English or German, following the browser's language setting):

- **SEND:** sends this tab's video to the TV; press again to bring it back. Without a video, SEND opens the TV window with its placeholder.
- **CLEAR:** ends all output; press again to close the TV window.
- **AUTO:** automatic mode, off by default. When it is on, a video started on allowed websites (default: youtube.com) goes to the TV by itself, and the TV follows the active tab.
- **OPT:** settings, such as the target display, the websites for automatic mode, parallel display and waiting times.

If the TV is disconnected, the video returns to the page, paused.

Videos that can't be copied (from other servers without CORS, presumably also copy-protected/DRM ones) are moved by tab2tv itself into a picture-in-picture window shown full screen on the TV. The picture in the page stays empty meanwhile; its player keeps control. If automatic mode switches to another tab's video, it returns to its page.

## Limits

In the picture-in-picture window, a narrow browser title bar stays visible at the top of the TV. Embedded players (iframes) don't get this window, so such videos can't be sent.

## Development

`extension/` is the extension (Manifest V3, no build step); the shared look of popup, settings and TV placeholder (colors, keys, lamps, font) is in `extension/style.css`. Texts are in `extension/_locales/` (`en`, `de`). `tools/` holds an isolated Brave test instance (`test-brave.sh`), CDP helpers and tests: `test-unit.mjs` runs without a TV, `test-multitab.mjs` and `test-automode.mjs` need the TV. The results of the technical exploration are in `docs/erkundung.md` (German).

## License

MIT, see `LICENSE`. Excepted is the font Tiny5 in `extension/fonts/tiny5/`, which is under the SIL Open Font License 1.1.
