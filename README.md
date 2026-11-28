# Performance Enhancer

A Revenge plugin that tunes Discord for the device it runs on, and lets you pick
the look of the client: **Material**, **Glassmorphism**, **Liquid Frost**, soft
cards, or a palette of your own.

- Plugin ID: `johndoehackie123.performance-enhancer`
- Works on Revenge for Android (JS-only, no native code, no root required)
- Settings live under **Settings → Revenge → Plugins → Performance Enhancer**

---

## Install

Revenge and Valenced ship different plugin runtimes, and the install steps
differ. Not sure which you have? Valenced shows **Settings → Valenced →
Plugins**; Revenge shows **Settings → Revenge → Plugins** (with an **Install a
plugin** button on the stable client, a **Browse plugins** screen on Revenge
Next). See [docs/runtime-support.md](docs/runtime-support.md) for the full
matrix.

### Valenced

1. **Settings → Valenced → Plugins → Add repository** (top of the screen).
2. Paste the repository index URL:

   ```
   https://raw.githubusercontent.com/Johndoehackie123/Performance-Enhancer/gh-pages/valenced/index.json
   ```

3. Install **Performance Enhancer** from the browse list.

No repository? Sideload the **Valenced ZIP** (`…-valenced.zip`) attached to the
[latest release](https://github.com/Johndoehackie123/Performance-Enhancer/releases):
**Settings → Valenced → Plugins → Install plugin from file** and pick it.

The Valenced build declares the mandatory `valenced.api` + `discord`
dependencies its loader requires; the ZIP is verified against the SHA-256 in
the repository index.

### Stable clients (Revenge Manager, RevengeXposed) — most Revenge users

1. Open Discord with Revenge installed.
2. Go to **Settings → Revenge → Plugins** and tap **Install a plugin**.
3. Paste this ZIP URL:

   ```
   https://raw.githubusercontent.com/Johndoehackie123/Performance-Enhancer/gh-pages/pool/johndoehackie123.performance-enhancer@1.3.0.zip
   ```

4. Confirm the "unproxied external source" warning, then enable the plugin.

The same ZIP is attached to the
[latest release](https://github.com/Johndoehackie123/Performance-Enhancer/releases).

### Revenge Next

1. **Settings → Revenge → Plugins** → gear icon next to *Plugins*.
2. Add the repository URL (the branch root — the client appends `index.json`):

   ```
   https://raw.githubusercontent.com/Johndoehackie123/Performance-Enhancer/gh-pages
   ```

3. Open **Browse Plugins**, install **Performance Enhancer**, then enable it.

Every repository download is verified against the SHA-256 in `index.json`.

The repository is a static `index.json` plus a `pool/` of ZIPs on the `gh-pages`
branch. By default it is served through `raw.githubusercontent.com`; enable
GitHub Pages for that branch and set the `PAGES_BASE_URL` Actions variable to
switch index links to the Pages URL (`.github/workflows/publish-index.yml`
regenerates the index).

---

## What it does

### Device-aware profiles

The plugin reads `DeviceModule` — RAM size, maximum CPU frequency, SoC model,
manufacturer and board — and buckets the phone into a **low / mid / high** tier.
`Auto` picks a profile from that tier; you can always override it.

| Profile | Media | Channel cache | GC after trim | Retry budget |
| --- | --- | --- | --- | --- |
| Battery saver | decoding off | 3 channels | no | 2 |
| Balanced | half prefetch | 8 channels | yes | 3 |
| Performance | full prefetch | 16 channels | yes | 4 |

### Memory

- Trims Discord's image/query caches and the file cache when the app is
  backgrounded, on `TRIM_MEMORY`, and from the **Trim now** button.
- Runs the Hermes garbage collector after a trim when the runtime exposes `gc`.
- All limits are configurable; the diagnostics panel reports entries released,
  measured bytes and trim count.

### Stability

- Watches gateway, resume and message-load failures in a one-minute window and
  logs one actionable warning per burst instead of letting the log flood.
- Never fabricates gateway actions — Discord stays authoritative over its socket.
- Retry bursts past the profile budget are recorded instead of hidden.

### Network

- Drops telemetry/science dispatches (`TRACK`, `SCIENCE`, `IMPRESSION`, …)
  before they reach the network stack.
- Optional zealous prefetch for fast connections.

### Style studio

| Style | What it looks like |
| --- | --- |
| **Material** | Tonal elevated panes, crisp 1px outline, indigo accent, elevation shadow |
| **Glassmorphism** | Translucent panel with a hairline highlight and a soft shadow |
| **Liquid Frost** | Heavier frost, milky film, larger radius, cool shadow |
| **Soft cards** | Low-contrast rounded cards with a flat outline |
| **Custom** | Your panel/accent colours, radius (0–32), transparency (0–100%), border (0–4) |

Details:

- Frost intensity: **light / medium / heavy**. Low-end devices never get blur —
  it is the most expensive effect the compositor can be asked for.
- Surfaces are individually toggleable: message rows, navigation bars, the
  composer, sheets/modals and media cards.
- **Round avatars** clips avatars into circles.
- **The whole app re-tints**, not just the panels: chat, sidebar, headers,
  inputs and every accent control are re-tinted to the active style, live, as
  you change the palette.
- **Register colour themes** adds all five palettes (Material, Glassmorphism,
  Liquid Frost, Soft Cards and your custom palette) to
  **Settings → Revenge → Themes**, with a light base generated from your panel
  colour instead of Discord's stock whites. Needs the optional
  `revenge.api.themes` plugin; the plugin works without it, and palette edits
  made in the studio propagate to the Themes screen without re-registering.
  Note: palettes registered through the Themes API stay in the picker until
  Discord restarts — the API has no unregister.
- A live preview renders the selected style with the exact token engine the
  live surfaces use: a mock message, avatar and the derived base/accent tonal
  scale, including your custom radius, border and transparency.

Visual styles are applied in two layers, both of which come off cleanly when
the plugin is disabled:

1. **JSX runtime hooks** on `jsx`/`jsxs` (the calls every compiled component
   makes), which re-tint the color props of every element that carries a style
   object, using the tonal scale derived from the active style — never by
   patching render functions, so React Compiler builds keep working.
   Registered `StyleSheet` IDs are left untouched.
2. **Themes registration**: the same palettes are exposed in
   **Settings → Revenge → Themes** as raw `BRAND_*` overrides plus
   dark/darker/midnight/light semantic maps, covering the parts of the UI
   that never carry inline styles.

### Diagnostics

Heap usage, cache trims, bytes released, gateway bursts, dispatch counts
(seen/dropped), restyled elements, and uptime. **Trim now** and
**Re-apply style** run the same code paths the plugin uses at runtime.

---

## Building

```bash
bun install            # required: see the note below
bun run lint:types     # type-check
bun run build          # bundle JS into plugins/*/build/js/index.js
bun run package        # bundle + write build/dist/{revenge,valenced}/<id>@<version>.zip
bun run index -- --dist build/dist/revenge --base-url https://example.com/pool --out index.json
node scripts/valenced-index.mjs --dist build/dist/valenced --base-url https://example.com/valenced --out valenced/index.json
node scripts/verify-stable.mjs   # loads both artifacts the way each client does
```

Requires bun 1.2+ (or Node 22.18+ for the scripts, with `npx tsc` for types).
The plugin uses `@revenge-mod/plugin-cli`, `@revenge-mod/types` and
`@revenge-mod/themes-api` from the official Revenge repositories, declared as git
dependencies in `package.json`.

> **Use bun, not npm.** `@revenge-mod/plugin-cli` is installed from git, so npm
> runs its `prepare` script (`tsc`) in isolation before the workspace peer
> `@revenge-mod/types` is linked, and the install fails. bun links workspace
> packages first, which is also why the official Revenge template uses it.
> `bun.lock` is committed so CI installs the exact CLI revision.

### Testing on a device

```bash
bun run serve          # serves a local repository with the built ZIP
```

Then open the URL printed by the CLI in **Settings → Revenge → Plugins**.

### Releasing

Bump `version` in `plugins/performance-enhancer/manifest.json` **and**
`plugins/performance-enhancer/manifest.valenced.json`, merge to `main`, and the
*Release plugin* workflow:

1. type-checks, builds and packages one ZIP per client (`build/dist/revenge/`
   and `build/dist/valenced/`);
2. verifies each artifact the way its client loads it;
3. plans releases by comparing manifests against the `gh-pages` pool and the
   `gh-pages` `valenced/` directory;
4. copies new artifacts into the pool, regenerates both `index.json`
   (`/index.json` for Revenge Next, `/valenced/index.json` for Valenced);
5. commits everything to `gh-pages` and creates a tagged GitHub release with
   both ZIPs attached.

Re-running is always safe: a version is released only once, and the planner
refuses downgrades.

---

## Layout

```
plugins/performance-enhancer/
├── manifest.json
├── js/
│   ├── index.tsx          plugin entry, lifecycle wiring
│   ├── device.ts          RAM/CPU/SoC detection and tiering
│   ├── profiles.ts        battery / balanced / performance knobs
│   ├── shared.ts          settings types, defaults, migration
│   ├── store.ts           runtime state + settings subscription
│   ├── perf/              memory, network, stability guards
│   ├── styles/            token engine, JSX recolor hooks, Themes registration
│   └── ui/                settings screen and preview
scripts/                   packaging, index, release planning
.github/workflows/         validate (PRs) and release (main)
```

## Licence

MIT. Revenge and Discord are not affiliated with this project; use at your own
risk and only with add-ons you trust.
