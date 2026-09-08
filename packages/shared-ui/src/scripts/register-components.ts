/**
 * register-components.ts
 * ----------------------
 * Registers the components CloudCannon may re-render in the Visual Editor.
 *
 * Loaded only when `window.inEditorMode` is true (see TreeLayout), so nothing
 * here reaches a visitor.
 *
 * NO REACT. CloudCannon's own guide imports
 * `@cloudcannon/editable-regions/astro-react-renderer` alongside this, but that
 * renderer is only needed for a component tree containing React islands —
 * `integrations/astro/index.mjs` imports no React itself and ships a default
 * renderer that handles plain tags. Every Tree* component is pure Astro, so the
 * renderer import is deliberately absent and React stays out of this site.
 *
 * WHAT MAY BE REGISTERED. A component region re-renders IN THE BROWSER, which
 * rules out anything whose frontmatter is build-only or whose behaviour comes
 * from a `<script>`:
 *
 *   - `TreePicture` calls `getImage()` from astro:assets, which cannot run
 *     client-side. Any component holding a photograph is therefore excluded —
 *     TreeHero, TreeAbout, TreeCommercial, TreeCtaBanner, TreeWhyChoose.
 *   - Components carrying their own `<script>` (carousels, the quote form)
 *     would re-render as inert markup, because the script does not run again.
 *
* That leaves the two below: text-and-icon sections that render from props
 * alone. They still take text and array regions like any other section; this
 * only adds live re-render on top.
 */
import { registerAstroComponent } from '@cloudcannon/editable-regions/astro';

import TreeCoreValues from '../components/TreeCoreValues.astro';
import TreeStatsBar from '../components/TreeStatsBar.astro';

registerAstroComponent('TreeCoreValues', TreeCoreValues);
registerAstroComponent('TreeStatsBar', TreeStatsBar);

// TreeServiceCapabilities and TreeServiceChecklist are equally safe to
// re-render, but they live inside ServiceSections, which is shared with the
// service-by-city pages where no prefix is passed. Wrapping them needs the
// <editable-component> element itself to be conditional — a custom element is
// display:inline by default, so emitting one on a page that cannot use it
// risks the layout. Left for a follow-up rather than guessed at.
