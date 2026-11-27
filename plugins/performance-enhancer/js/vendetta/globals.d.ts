/**
 * Globals the stable loader provides.
 *
 * `VdPluginManager` evaluates a plugin's source as
 * `(bunny, definePlugin) => { <source>; return plugin?.default ?? plugin; }`,
 * so `bunny` is a real binding in scope for the whole bundle. It is declared
 * here so the entry can hand it to the bridge instead of hoping a global exists.
 */
declare const bunny: unknown
