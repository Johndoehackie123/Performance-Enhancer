/**
 * Loader-provided parameters.
 *
 * The stable loader evaluates a plugin's source as
 * `(bunny, definePlugin) => { <source>; return plugin?.default ?? plugin; }`,
 * and the modern loaders evaluate it as
 * `new Function('valenced'|'revenge', 'plugin', 'return ' + src)`.
 * In both cases the first parameter is a real binding in scope for the whole
 * bundle — more reliable than the globals, which Valenced's own `api.hidden`
 * internal plugin deletes again in its cleanup. They are declared here so the
 * entry and the bridge can hand them around explicitly.
 */
declare const bunny: unknown
declare const valenced: unknown
declare const revenge: unknown
