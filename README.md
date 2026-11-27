# Performance Enhancer

A Revenge plugin that tunes Discord for the device it runs on, and lets you pick
the look of the client: **Material**, **Glassmorphism**, **Liquid Frost**, soft
cards, or a palette of your own.

- Plugin ID: `johndoehackie123.performance-enhancer`
- Works on Revenge for Android (JS-only, no native code, no root required)
- Settings live under **Settings → Revenge → Plugins → Performance Enhancer**

---

## Install

**From the plugin repository (recommended):**

1. Open Discord with Revenge installed.
2. Go to **Settings → Revenge → Plugins**, tap the gear icon next to *Plugins*.
3. Add the repository URL:

   ```
   https://johndoehackie123.github.io/Performance-Enhancer
   ```

4. Open **Browse Plugins**, install **Performance Enhancer**, then enable it.

**Sideloading:** download the ZIP from the
[releases page](https://github.com/Johndoehackie123/Performance-Enhancer/releases)
and use *Install from file* in the same settings screen.

Every repository download is verified against the SHA-256 in `index.json`.

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
- **Register colour themes** adds the same palettes to
  **Settings → Revenge → Themes** (needs the optional `revenge.api.themes`
  plugin; the plugin works without it).
- A live preview renders the selected style with the exact token engine the
  live surfaces use.

Styles are applied through Revenge's JSX runtime hooks on discovered Discord
components — never by patching render functions — so they keep working with
React Compiler builds and can be removed cleanly when the plugin is disabled.

### Diagnostics

Heap usage, cache trims, bytes released, gateway bursts, dispatch counts
(seen/dropped), active style hooks, and uptime. **Trim now** and
**Re-apply style** run the same code paths the plugin uses at runtime.

---

## Building

```bash
bun install            # required: see the note below
bun run lint:types     # type-check
bun run build          # bundle JS into plugins/*/build/js/index.js
bun run package        # bundle + write build/dist/<id>@<version>.zip
bun run index -- --dist build/dist --base-url https://example.com/pool --out index.json
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

Bump `version` in `plugins/performance-enhancer/manifest.json`, merge to `main`,
and the *Release plugin* workflow:

1. type-checks, builds and packages the plugin;
2. plans releases by comparing manifests against the `gh-pages` pool;
3. copies new artifacts into `pool/` and regenerates `index.json`;
4. commits both to `gh-pages` and creates a tagged GitHub release with the ZIP.

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
│   ├── styles/            token engine, JSX hooks, Themes registration
│   └── ui/                settings screen and preview
scripts/                   packaging, index, release planning
.github/workflows/         validate (PRs) and release (main)
```

## Licence

MIT. Revenge and Discord are not affiliated with this project; use at your own
risk and only with add-ons you trust.
