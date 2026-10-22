/** A parsed XML element, namespace-aware, as the PPTX importer reads every part. */
export interface X { uri: string; name: string; attrs: Record<string, string>; children: X[]; text: string }
export const key = (uri: string, name: string) => `{${uri}}${name}`;
export const at = (n: X | undefined, name: string, uri = '') => n?.attrs[key(uri, name)];
export const kids = (n: X | undefined, uri: string, name: string) => n?.children.filter(x => x.uri === uri && x.name === name) ?? [];
export const child = (n: X | undefined, uri: string, name: string) => kids(n, uri, name)[0];
export const path = (n: X | undefined, ...steps: [string, string][]) => steps.reduce<X | undefined>((p, [uri, name]) => child(p, uri, name), n);
export function walk(n: X | undefined, uri: string, name: string): X[] { return n ? [...(n.uri === uri && n.name === name ? [n] : []), ...n.children.flatMap(c => walk(c, uri, name))] : []; }
