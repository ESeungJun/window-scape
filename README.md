<p align="center"><img src="docs/images/icon.png" width="120" alt="WINDOW SCAPE"></p>

<h1 align="center">WINDOW SCAPE · 창밖날씨</h1>

<p align="center">A little window on your desktop that shows today's weather as a living low-poly landscape.<br>
When it rains outside, it rains in the window. When the sun sets, the village lights come on.</p>

<p align="center"><a href="https://github.com/ESeungJun/window-scape/releases/latest"><b>⬇ Download the latest release (macOS · Windows)</b></a></p>

<p align="center"><b>English</b> · <a href="README.ko.md">한국어</a></p>

<p align="center"><img src="docs/images/hero.jpg" width="100%" alt="WINDOW SCAPE: a floating sky island above a sea of clouds, with a 7-day forecast"></p>

---

I came across [a reel by Pascal Mager (@hellothere.de)](https://www.instagram.com/reel/DeNVdk7oPYA/) on Instagram —
a tiny Blender + Three.js island that changes with the real weather — and fell in love with it instantly.
So I built my own.

The original is a website. I wanted something that lives quietly in the corner of my desktop,
so WINDOW SCAPE is a native macOS widget. It started as a single sky island and grew into five hand-made worlds.
(Everything — models and code — was built from scratch; only the idea of a weather-driven 3D miniature was borrowed.)

## Five worlds

<table>
  <tr>
    <td align="center" width="50%"><b>Sky Island</b><br>A floating isle with a windmill and waterfalls<br><img src="docs/images/theme-island.jpg" alt="Sky Island theme"></td>
    <td align="center" width="50%"><b>Coastal Drive</b><br>Cars leaving a tunnel along the shore, a lighthouse isle and a sailboat<br><img src="docs/images/theme-drive.jpg" alt="Coastal Drive theme"></td>
  </tr>
  <tr>
    <td align="center"><b>Florence Town</b><br>A shop-lined bridge, a red-domed cathedral, terracotta roofs<br><img src="docs/images/theme-city.jpg" alt="Florence Town theme"></td>
    <td align="center"><b>Walking Castle</b><br>A four-legged castle roaming a dirt road through the fields<br><img src="docs/images/theme-castle.jpg" alt="Walking Castle theme"></td>
  </tr>
  <tr>
    <td align="center"><b>Forest</b><br>A riverside log cabin in an endless pine forest<br><img src="docs/images/theme-forest.jpg" alt="Forest theme"></td>
    <td align="center"><b>Desktop widget</b><br>Small and calm: just the scene and the temperature<br><img src="docs/images/widget.png" alt="Desktop widget"></td>
  </tr>
</table>

The Walking Castle is an original design — a ramshackle castle on mechanical legs —
inspired by the idea of a moving castle, not a copy of any film's design.

## It follows the sky

<table>
  <tr>
    <td align="center" width="50%"><b>Night · thunderstorm</b><br><img src="docs/images/weather-storm.jpg" alt="Lightning over the sky island at night"></td>
    <td align="center" width="50%"><b>Winter morning · snow</b><br><img src="docs/images/weather-snow.jpg" alt="Snow-covered winter forest"></td>
  </tr>
  <tr>
    <td align="center"><b>Night · lit windows</b><br><img src="docs/images/weather-night.jpg" alt="Florence town with lit windows at night"></td>
    <td align="center"><b>Sunset</b><br><img src="docs/images/weather-sunset.jpg" alt="Coastal road at sunset"></td>
  </tr>
</table>

- **Time of day** — morning, day, evening and night light; windows and street lamps glow after dark.
- **Weather** — ten conditions from clear skies to rain, thunderstorms, snow, fog and rainbows. Strong wind spins the windmill and sways the trees.
- **Seasons** — cherry blossoms in spring, red leaves in autumn, and snow that settles when it's actually freezing.
- **Live or preview** — it mirrors the current weather where you are, or lets you preview any combination from the settings.

## Made to live on your desktop

- **Pin to desktop or keep on top** — tuck it behind your windows like wallpaper, or float it above everything.
- **Opacity** — fade it down to 30% for a subtle ambient view.
- **Responsive** — resize freely; small shows just the scene, larger adds the 7-day bar and hourly chart.
- **Auto-update** — new versions download and install themselves.
- **And more** — current-location weather, city search, launch at login, and optional waterfall and rain ambience.

## Install

Grab the file for your computer from the [latest release](https://github.com/ESeungJun/window-scape/releases/latest).

| Computer | File |
| --- | --- |
| Mac (Apple Silicon, M1 and later) | `window-scape-…-mac-arm64.dmg` |
| Mac (Intel) | `window-scape-…-mac-x64.dmg` |
| Windows 10/11 (64-bit) | `window-scape-…-windows-x64-setup.exe` |

- **Mac** — move `창밖날씨.app` to Applications and open it. It's signed and notarized by Apple, so it opens without any warning. (macOS 11+)
- **Windows** — run the installer. It isn't code-signed yet, so if SmartScreen warns you, click `More info` → `Run anyway`.

It starts in the top-right corner, kept on top of other windows; use the window icon in the menu bar (the system tray on Windows) to move it or change how it's layered.

## Built with

- **[Three.js](https://threejs.org/)** — every island, building, tree and castle is generated in code; no model files.
- **[Tauri 2](https://tauri.app/)** — a ~10 MB native app that's light enough to keep running all day.
- **[Open-Meteo](https://open-meteo.com/)** (CC BY 4.0) — free weather data, no API key needed.

Built together with Claude Code.

## Development

```bash
npm install
npm run dev                          # web version at http://localhost:5173
npm run tauri dev                    # desktop widget (needs Rust once: https://rustup.rs)
npm run build                        # type-check + web build
```

In the web version, press `F` or open `?showcase` to frame the scene in a rounded window.

<details>
<summary>Project layout and releases</summary>

| Path | Role |
|---|---|
| `src/scene/kit.ts` | Shared materials, props, terrain, instanced trees, waterfalls |
| `src/scene/{island,drive,city,castle,forest}.ts` | The five worlds |
| `src/scene/world.ts` | Renderer, camera, lights, theme switching, frame loop |
| `src/scene/{env,sky,clouds,precipitation}.ts` | Time/weather/season blending, sky, clouds, rain/snow/lightning/rainbow |
| `src/data/weather.ts` | Open-Meteo forecast and geocoding, weather codes, local time and season |
| `src/ui/*` | Current weather, forecast, view settings, widget settings (layer, opacity, updates) |
| `src-tauri/` | Tauri app: menu bar, window layering, current location (CoreLocation), updater |

Pushing a `v*` tag makes GitHub Actions build a universal app, sign it with a Developer ID, notarize it with Apple,
and publish the DMG plus the auto-update files (`latest.json`).
Required secrets: `MAC_CERT_P12`, `MAC_CERT_PASSWORD`, `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

</details>

## Credits

- **Inspiration** — "Blender + Threejs + Wetter" reel by [Pascal Mager (@hellothere.de)](https://www.instagram.com/reel/DeNVdk7oPYA/)
- **Weather data** — [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
