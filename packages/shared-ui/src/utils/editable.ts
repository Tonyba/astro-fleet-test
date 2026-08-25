/**
 * editable.ts
 * -----------
 * Helpers for CloudCannon's Visual Editor.
 *
 * The editor binds a rendered element back to a key in the file that produced
 * the page, through two data attributes:
 *
 *   data-editable="text"      what kind of region this is
 *   data-prop="hero.title"    the path to the key, from the ROOT of that file
 *
 * Every component here takes an optional `editablePrefix`. Passing it opts the
 * component into visual editing and states where its props came from in the
 * page's source file — `<TreeAbout {...home.about} editablePrefix="about" />`
 * makes the heading bind to `about.heading`. Leaving it off emits nothing at
 * all, which is what every site that is not edited in CloudCannon wants.
 *
 * The prefix has to be supplied per usage, not baked into the component,
 * because the same component sits at a different key on different pages: the
 * hero of a service page is `hero` in that service's markdown, while the same
 * component on the homepage reads `home.json`.
 *
 * An empty-string prefix means "these props are the root of the file", so
 * `editablePrefix=""` binds `title` rather than `.title`.
 */

/** Region types CloudCannon understands on a plain element. */
export type EditableType = 'text' | 'image' | 'array' | 'array-item';

/**
 * Attributes binding one element to one key.
 *
 * Returns an empty object when no prefix was given, and Astro drops attributes
 * whose value is undefined — so an un-opted-in component renders byte-identical
 * markup to before.
 */
export function editable(
  prefix: string | undefined,
  path: string,
  type: EditableType = 'text'
): Record<string, string> {
  if (prefix === undefined) return {};
  const full = prefix ? (path ? `${prefix}.${path}` : prefix) : path;
  return { 'data-editable': type, 'data-prop': full };
}

/**
 * Attributes binding an <img> to the keys holding its path and its alt text.
 *
 * Images use a different shape from text: `data-prop-src` and `data-prop-alt`
 * rather than a single `data-prop`, because one region edits two keys at once —
 * picking a new photograph in the editor should let you retype the alt text in
 * the same breath. Both paths are relative to `prefix`, exactly like `editable`.
 *
 * `altKey` is optional: some slots are decorative or take their alt from
 * elsewhere, and binding a key that does not exist in the file would offer the
 * editor a field that writes somewhere nothing reads.
 */
export function editableImage(
  prefix: string | undefined,
  srcKey: string | undefined,
  altKey?: string
): Record<string, string> {
  if (prefix === undefined || !srcKey) return {};
  const join = (key: string) => (prefix ? `${prefix}.${key}` : key);
  return {
    'data-editable': 'image',
    'data-prop-src': join(srcKey),
    ...(altKey ? { 'data-prop-alt': join(altKey) } : {}),
  };
}

/**
 * Join a prefix with a sub-path, for handing a nested prefix to a child
 * component: `child(editablePrefix, 'items')` then indexes as `items.0.title`.
 */
export function childPrefix(prefix: string | undefined, path: string): string | undefined {
  if (prefix === undefined) return undefined;
  return prefix ? `${prefix}.${path}` : path;
}
