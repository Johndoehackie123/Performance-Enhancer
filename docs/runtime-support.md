# Runtime support

Revenge currently ships **two different plugin runtimes**. A plugin only loads if
it matches the one on the user's device, and they are not compatible.

| | Stable (Revenge Manager, RevengeXposed) | Next (`revenge-bundle-next`) |
| --- | --- | --- |
| Bundle version | `revenge-bundle` v1.x (currently 1.12.1) | 0.1.x |
| Install UI | Settings → Revenge → Plugins → **Install a plugin** (URL) | Settings → Revenge → Plugins → gear → **Add repository** |
| Distribution | a URL serving `manifest.json` + the JS file | a repository serving `index.json` + ZIPs |
| Plugin file | one IIFE exposing `plugin` | one IIFE exposing `plugin` (options object) |
| API object | `window.vendetta` / the loader's first parameter | the `revenge.*` globals |
| Settings storage | `plugin.storage` (auto-persisted) | `plugin({ jsonStorage })` |
| Settings screen | `SettingsComponent` rendered with **no props** | `SettingsComponent({ api })` |
| Plugin API version | `1.2.1` (from `gradle/libs.versions.toml`) | stamped with the bundle version |

## Why 1.0.0 and 1.0.1 could not install

Both releases were built only for **Next**. That build has three properties that
break it on the stable runtime:

1. **It references `revenge.*` at module scope.** The stable runtime has no
   `revenge` global, so the source throws while it is still being defined. The
   loader's `return plugin?.default ?? plugin` never runs, and the user sees an
   install failure or an immediately-disabled plugin.
2. **It wraps options in `plugin({...})`.** That helper is Next-only. On stable,
   calling it throws `plugin is not defined`.
3. **It declares `dist.script`,** which stable's sideload validator ignores (it
   reads the manifest and then always loads `index.js`), and requires
   `revenge.api >=1.2.1 <2` — satisfiable on Next, harmless but meaningless on
   stable.

The repository index itself was never the problem: `index.json` was valid, its
SHA-256 matched the artifact, and the manifest passed every structural check.
Adding the repository worked; installing from it could not.

## How this repository supports both

`plugins/performance-enhancer/js/` holds the Next implementation. The new
`js/vendetta/` directory holds the stable implementation, and
`scripts/build-vendetta.mjs` compiles it into **the same `index.js`** the ZIP
ships, so one artifact works on both clients:

- the bundle reads React from the loader's `bunny` parameter, never from a global;
- host capabilities are probed, not assumed — a missing `FluxDispatcher` or
  `TableRadioGroup` degrades one control instead of throwing;
- the source is a single expression (`globalThis.plugin = …`) so it satisfies
  both loaders' evaluation strategies.

`scripts/verify-stable.mjs` reproduces both loaders and fails the build if the
packaged artifact stops loading on either. It runs in CI right after packaging.

## Installing

**Stable clients** (this is what the release notes point at):

1. Settings → Revenge → Plugins → **Install a plugin**
2. Paste the ZIP URL:
   `https://raw.githubusercontent.com/Johndoehackie123/Performance-Enhancer/gh-pages/pool/johndoehackie123.performance-enhancer@1.1.0.zip`
3. Confirm the unproxied-source warning and enable the plugin.

**Next clients:** add `https://raw.githubusercontent.com/Johndoehackie123/Performance-Enhancer/gh-pages`
as a repository, then install from Browse Plugins.
