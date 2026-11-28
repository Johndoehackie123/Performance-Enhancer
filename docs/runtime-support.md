# Runtime support

The plugin ships **one JS bundle** that runs on all of the currently supported
Android clients, and **one ZIP per client** because the clients disagree on the
manifest contract. 1.2.3 is the first release that is known to install, enable and
open the settings screen on **Valenced** and on **Revenge** — 1.2.0 crashed in
`init`, and 1.2.1/1.2.2 crashed when the settings screen mounted (see below).

**1.3.0** reworks the visual styles so they apply to the whole app, not just the
handful of components the JSX hooks could identify by name:

1. **Structural recolor layer.** The JSX hook now walks every element's `style`
   prop and substitutes Discord's stock palette (modern *and* legacy) for a
   tonal scale derived from the active style — `BACKGROUND_BASE_*`
   backgrounds, text tiers and the whole `BRAND_*` accent family follow the
   active panel/accent. It touches only color keys (`backgroundColor`,
   `color`, borders, shadows…), never layout, and passes registered
   `StyleSheet` IDs through untouched. It is memoised per style object,
   rebuilt whenever the palette changes, and therefore applies live with no
   reload.
2. **Themes API everywhere.** Palette registration now runs on the stable
   build too (it was Next-only), registers all five palettes (Material,
   Glassmorphism, Liquid Frost, Soft Cards, Custom) instead of four, reads
   colors lazily from live settings (edits propagate to the Themes screen
   without re-registering), generates the light base by lifting the panel
   toward white instead of hard-coded greys, and derives a full `BRAND_*`
   scale and the modifier/text tiers from the same tonal scale the JSX layer
   uses — so both layers always agree.
3. **Known limits.** The Themes API has no unregister: palettes registered by
   the plugin stay in the picker until Discord restarts. The structural
   recolor cannot decode numeric `StyleSheet` IDs — surfaces painted through
   registered styles only pick up the palette through the Themes registration
   or Discord's own theme resolver. Discord builds that remove inline styles
   from Hermes bytecode entirely would see no effect either way.

| | Stable (Revenge Manager, RevengeXposed) | Next (`revenge-bundle-next`) | Valenced (`valenced`) |
| --- | --- | --- | --- |
| Install UI | Settings → Revenge → Plugins → **Install a plugin** (URL) | Settings → Revenge → Plugins → gear → **Add repository** | Settings → Valenced → Plugins → **Add repository**, or **Install plugin from file** |
| Distribution | a URL serving `manifest.json` + the JS file | a repository serving `index.json` + ZIPs | a repository serving `index.json` + ZIPs, or a sideloaded ZIP |
| Repository URL | n/a | the branch root — the client appends `index.json` | the verbatim `index.json` URL |
| Plugin file | one IIFE exposing `plugin` | one expression returning the options (or a namespace with `.default`) | same as Next |
| Loader expression | `(bunny, definePlugin) => { <src>; return plugin?.default ?? plugin }` | `new Function('revenge', 'plugin', 'return ' + src)` | `new Function('valenced', 'plugin', 'return ' + src)` |
| API object | `window.vendetta` / the loader's `bunny` parameter | the `revenge.*` globals | the `valenced.*` globals |
| Settings storage | `plugin.storage` (loader-persisted) | `plugin({ jsonStorage })` | `plugin({ jsonStorage })` |
| Lifecycle | `onLoad` / `start` / `onUnload` | `init` / `start` / `stop` | `init` / `start` / `stop` |
| Settings screen | `SettingsComponent`, no props | `SettingsComponent({ api })` | `SettingsComponent({ api })` |
| Mandatory dependencies | `revenge.api` + `discord` (Revenge rejects otherwise) | `revenge.api` + `discord` | `valenced.api` + `discord` (Valenced rejects otherwise) |
| Plugin API version | `1.2.1` (Revenge Manager / RevengeXposed) | stamped with the bundle | `1.1.0` → declared as `>=1 <2` |

## Why Valenced rejected 1.1.0

Two independent bugs, both invisible on Revenge:

1. **The manifest declared the wrong API.** Valenced's `stagePluginZip` runs its
   manifest validator before anything is extracted, and the validator requires
   `valenced.api` **and** `discord` as non-optional dependencies
   (`MANIFEST_INVALID … does not declare the mandatory 'valenced.api' dependency`).
   A `revenge.api`-only manifest is therefore uninstallable on Valenced no matter
   how valid the JS is.
2. **The bundle was a statement sequence, not an expression.** Both modern
   loaders evaluate the source as `return <source>`. The 1.1.0 bundle starts with
   a `function __peHost() {…}` declaration, so the returned value was that
   function instead of the plugin options. Valenced would have rejected the
   options (`SettingsComponent must be a function React component`) even with a
   valid manifest.

Neither bug could be reported by Revenge: its stable loader evaluates the source
as statements and reads `plugin` from the global scope, which the bundle set as
a side effect.

## Why 1.2.0 crashed on device after installing

1.2.0 **installed** everywhere it could be installed, then died inside `init`
(Revenge: inside `onLoad`) with:

```
[PLUGIN_ERROR] Property 'structuredClone' doesn't exist
ReferenceError: Property 'structuredClone' doesn't exist
```

`structuredClone` is a WHATWG API, not ECMAScript, and Hermes — the JS engine
in React Native and Discord — deliberately does not implement it
([facebook/hermes#684](https://github.com/facebook/hermes/issues/684)).
`withDefaults()` called `structuredClone(defaults)` while wiring the settings
store, so the very first call into the plugin threw on every client.

1.2.1 replaces `structuredClone` with a small recursive `deepClone` for plain
JSON data and adds a check to `scripts/verify-stable.mjs` that rejects the
bundle if it references any global the runtime demonstrably does not provide
(`structuredClone`, `Object.hasOwn`, `Array.prototype.at`, `Promise.allSettled`,
etc.). That check runs in CI on every build.

## Why 1.2.1 crashed when opening the settings screen (and why 1.2.2 didn't fix it)

1.2.1 and 1.2.2 both installed, enabled and survived `init`/`start` — then
crashed the moment the settings screen mounted, with the screen's own error
surfaced through Valenced's `PluginSettings` boundary:

```
TypeError: undefined is not a function
  at Ke (Valenced:Plugin:johndoehackie123.performance-enhancer)
  at Xe (Valenced:Plugin:johndoehackie123.performance-enhancer)
  at renderWithHooks
```

`Ke` is the settings screen's store hook. The first fix (1.2.2) removed React
18's `useSyncExternalStore`, because RN 0.68/0.69-class renderers lack that
dispatcher slot
([TanStack/query#3839](https://github.com/TanStack/query/issues/3839),
[endograph/redux-persist#1380](https://github.com/endograph/redux-persist/issues/1380)) —
still correct as defense-in-depth, but it was not the crash. 1.2.2 crashed at
the exact same place.

The real root cause: **the plugin script is evaluated during Valenced's
`preInit` phase, before Discord's React module exists** (Valenced resolves it
lazily via its own `waitForModules(withProps('useState'))`). The bundle used to
capture the React namespace as a plain IIFE argument at evaluation time
(`__peHost().react?.React`), so the captured binding was permanently
`undefined` — and every hook call threw `undefined is not a function`.
Additionally, Valenced's internal `api.hidden` plugin deletes
`globalThis.valenced` again in its cleanup, so nothing resolved late through
the global could survive either.

1.2.3 fixes the class, in three parts:

- The bundle hands out **lazy forwarding proxies** for React, React Native and
  the JSX runtime (`__peLazy` in `scripts/build-vendetta.mjs`): every property
  read hits the host at access time. The proxies report a fixed, complete key
  list and implement `ownKeys`/`getOwnPropertyDescriptor`, because rolldown's
  CJS interop enumerates the externals once at evaluation time (when the host
  modules still don't exist) — without those traps the interop produced a
  `{ default: <proxy> }` stub with no hooks at all.
- Host resolution prefers the loader-scoped bindings (`bunny` / `valenced` /
  `revenge` function parameters) over the globals, which may be deleted by the
  client at any time.
- The verifier now simulates the whole scene: `react.*` reads return
  `undefined` until after evaluation (like preInit), the settings tree is
  rendered through real component invocation, and the modern runs delete the
  `valenced`/`revenge` global right after evaluation to mirror Valenced's own
  cleanup. The published 1.2.2 artifacts fail these checks with the exact
  device error; 1.2.3 passes them.

An earlier version of this document told the `useSyncExternalStore` story as
the root cause. That was wrong; it is kept here only as context for why the
hook is gone (it belongs to React 18 renderers and this renderer predates it).

One manifest cannot serve both modern clients: Revenge's reserved dependency set
is `revenge.api` + `discord`, Valenced's is `valenced.api` + `discord`, and in
both clients a plugin whose mandatory dependency is absent is dropped from the
dependency graph (`DEPENDENCY_MISSING`) — and a mandatory dependency cannot be
`optional`. The packager therefore builds **two ZIPs from the same JS**:

| ZIP | Manifest | Published to |
| --- | --- | --- |
| `build/dist/revenge/<id>@<version>.zip` | `revenge.api >=1.2.1 <2` + `discord` (+ optional `revenge.api.themes`) | `pool/` → `gh-pages/index.json` (Revenge Next), or directly for stable sideload |
| `build/dist/valenced/<id>@<version>.zip` | `valenced.api >=1 <2` + `discord` | `valenced/` → `gh-pages/valenced/index.json` (Valenced), also attached to releases as `…-valenced.zip` |

Both `index.json` documents are the same format (format 1), and both are
generated from the artifacts on `gh-pages` — see `scripts/valenced-index.mjs`
for the Valenced one (the official CLI hard-codes the Revenge reserved
dependency IDs). Valenced aborts the install when an index's `dependencies` do
not match the artifact's manifest, so the generator copies them verbatim.

## The JS bundle

`plugins/performance-enhancer/js/vendetta/` compiles into the one `index.js`
that ships in both ZIPs. It satisfies all three loaders:

- The whole source is a **single assignment expression**
  (`globalThis.plugin = (function () { … })()`). The stable loader reads the
  `plugin` global after the statements run; the modern loaders return the
  expression's value, whose `.default` is the options object.
- React, React Native and the JSX runtime resolve at call time from the host:
  `host.react.React` / `host.react.ReactJSXRuntime` on Next and Valenced,
  `host.metro.common.*` (and `host._jsx`) on stable.
- The API tree is probed, not assumed: `host.modules.finders.lookupModule` +
  `filters.withProps` (modern) or `host.metro.findByProps` (stable) for module
  lookup; `host.discord.flux.onFluxEventDispatched` (modern) or the stable Flux
  dispatcher for telemetry blocking; `host.discord.actions.ToastActionCreators`
  (modern) or `host.ui.toasts.showToast` (stable) for toasts.
- Lifecycle is dual-shaped: `onLoad`/`onUnload` for stable, `init`/`start`/`stop`
  for Next and Valenced. `start` is shared; the modern runtimes register their
  cleanups through the lifecycle API's `cleanup(...)`, and the stable runtime
  through `onUnload`.
- Settings persist through the loader on stable (`plugin.storage`) and through
  `jsonStorage` on Next and Valenced, wired up in `init` from the store the
  client creates for plugins that declare `jsonStorage` in their options.

`scripts/verify-stable.mjs` reproduces all three loaders against a mock host
per client and fails the build if either artifact stops loading. It runs in CI
right after packaging, and it re-checks the manifest for each client
(mandatory, non-optional reserved dependencies) so a 1.1.0-style release cannot
ship again.

## Installing

**Valenced**

1. Settings → Valenced → Plugins → **Add repository**
2. Paste `https://raw.githubusercontent.com/Johndoehackie123/Performance-Enhancer/gh-pages/valenced/index.json`
3. Install **Performance Enhancer** from the browse list — or sideload the
   `…-valenced.zip` from the [latest release](https://github.com/Johndoehackie123/Performance-Enhancer/releases)
   with **Install plugin from file**.

**Stable clients** (Revenge Manager, RevengeXposed)

1. Settings → Revenge → Plugins → **Install a plugin**
2. Paste `https://raw.githubusercontent.com/Johndoehackie123/Performance-Enhancer/gh-pages/pool/johndoehackie123.performance-enhancer@1.2.3.zip`
3. Confirm the unproxied-source warning and enable the plugin.

**Next clients**

1. Settings → Revenge → Plugins → gear icon → **Add repository**
2. Paste `https://raw.githubusercontent.com/Johndoehackie123/Performance-Enhancer/gh-pages` (the client appends `index.json`)
3. Install from **Browse plugins**.
