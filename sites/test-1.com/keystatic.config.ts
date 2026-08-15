import { config, collection, singleton, fields } from '@keystatic/core';
import { r2Image } from '@astro-fleet/shared-ui/src/media/r2-image-field';

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
// Keystatic is a GIT-BASED CMS: it commits content straight back to the repo.
//
//   dev  -> `local`  : edits are written to disk by the dev server, you commit
//                      them yourself. No OAuth, no GitHub App.
//   prod -> `github` : the deployed /keystatic route authenticates against a
//                      GitHub App and commits to the branch below.
//
// This is a monorepo, so `pathPrefix` scopes every path in this file to the
// site folder — that is why the `path` options below are site-relative
// (`src/content/...`) rather than repo-relative.
const isDev = import.meta.env?.DEV ?? process.env.NODE_ENV === 'development';

const storage = isDev
  ? ({ kind: 'local' } as const)
  : ({
      kind: 'github',
      repo: 'tonyba/astro-fleet-test', // TODO: change to your real GitHub repo
      pathPrefix: 'sites/test-1.com',
      branchPrefix: '', // '' = every branch is editable
    } as const);

// ---------------------------------------------------------------------------
// Media — two stores, split by what the file IS
// ---------------------------------------------------------------------------
// PHOTOGRAPHS go to R2 (`photo`, `scopedPhoto`, `badge`, `graphic`). They are
// the bytes: 26 MB of them on this site alone, uploaded from an editor's phone
// at whatever size the camera produced. Committing those to git cost a
// repository that grew with every edit and a repair pipeline to go with it.
// Now the file goes to the bucket and the entry stores `r2:<key>`; the build
// downloads the original once and emits the same AVIF/WebP/JPEG ladder it
// always did (see TreePicture.astro). Nothing is resized at request time.
//
// THIS SITE RENDERS ON DEMAND, which puts one condition on that: the only
// moment Astro can encode anything is while `/image-manifest.json` prerenders,
// so a key that reaches content AFTER a build has no ladder and is served
// straight from the bucket. CI closes that gap — a content sync that
// introduces an unseen `r2:` key is not treated as content-only and does
// rebuild. See .github/workflows/ci.yml.
//
// VECTORS AND SITE MARKS stay in the repo (`icon`, `scopedIcon`, `rootFile`,
// `mediaFile`). An SVG icon is 2 KB, is served from this origin, and in one
// case is a CSS mask-image — none of which is improved by a second domain and
// an extra connection. public/ is copied verbatim, which is exactly right for
// them.
//
// For the repo-backed fields below, `directory` is where the file is stored and
// `publicPath` is the string written into the content file. NOTE ON
// COLLECTIONS: for an entry in a collection Keystatic appends the entry's slug
// to both halves, which is why every service owns a folder under
// public/media/icons/. Renaming a service moves its folder — re-pick its icons
// afterwards. R2-backed fields have no such behaviour: their keys come from the
// filename and a content hash, so nothing moves when an entry is renamed.
type ImageOpts = { label: string; description?: string; required?: boolean };

/**
 * Photograph — goes through <Picture />, stored in R2.
 *
 * The prefix is organisational only. Nothing resolves through it, so unlike
 * Keystatic's `directory` it can be renamed without orphaning an image.
 */
const photo = ({ label, description, required = false }: ImageOpts) =>
  r2Image({ label, description, prefix: 'photos', validation: { isRequired: required } });

/**
 * Photograph filed under a page of its own, e.g. `photos/about/`.
 *
 * This scoping used to be load-bearing rather than cosmetic. Keystatic derives
 * an image's path from the FIELD path alone — the singleton it belongs to is
 * not part of it — so two singletons sharing a field shape resolved to the SAME
 * file: every page built from `pageHero` wanted `photos/hero/image.jpg`, and
 * saving one page relocated that file out from under the others, which GitHub
 * rejected outright ("A path was requested for deletion which does not exist").
 *
 * R2 keys are derived from the file's own name and content hash instead, so
 * collisions of that kind are no longer possible. The scope is kept because a
 * bucket is easier to read when it is organised by page.
 */
const scopedPhoto =
  (scope: string) =>
  ({ label, description, required = false }: ImageOpts) =>
    r2Image({
      label,
      description,
      prefix: `photos/${scope}`,
      validation: { isRequired: required },
    });

/** Trust / accreditation badge. */
const badge = ({ label, description, required = false }: ImageOpts) =>
  r2Image({ label, description, prefix: 'badges', validation: { isRequired: required } });

/** Flat illustration (process steps). */
const graphic = ({ label, description, required = false }: ImageOpts) =>
  r2Image({ label, description, prefix: 'graphics', validation: { isRequired: required } });

/** SVG/PNG icon served verbatim from public/media/icons. */
const icon = ({ label, description, required = false }: ImageOpts) =>
  fields.image({
    label,
    description,
    directory: 'public/media/icons',
    publicPath: '/media/icons/',
    validation: { isRequired: required },
  });

/** The same, in a folder of its own — see `scopedPhoto` for why scoping matters. */
const scopedIcon =
  (scope: string) =>
  ({ label, description, required = false }: ImageOpts) =>
    fields.image({
      label,
      description,
      directory: `public/media/icons/${scope}`,
      publicPath: `/media/icons/${scope}/`,
      validation: { isRequired: required },
    });

/**
 * Favicon — lives at the root of public/ (where it has always been requested
 * from) rather than under public/media, so the existing /favicon.svg keeps
 * working and a re-upload replaces it in place.
 */
const rootFile = ({ label, description, required = false }: ImageOpts) =>
  fields.image({
    label,
    description,
    directory: 'public',
    publicPath: '/',
    validation: { isRequired: required },
  });

/**
 * Anything at the root of public/media (the logo, the social marks). The
 * publicPath is the folder root, so values already nested under
 * `/media/icons/` keep working here too.
 */
const mediaFile = ({ label, description, required = false }: ImageOpts) =>
  fields.image({
    label,
    description,
    directory: 'public/media',
    publicPath: '/media/',
    validation: { isRequired: required },
  });

// ---------------------------------------------------------------------------
// Field shorthands
// ---------------------------------------------------------------------------
/** Required single-line string. */
const str = (label: string, description?: string) =>
  fields.text({ label, description, validation: { length: { min: 1 } } });

/** Optional single-line string. */
const strOpt = (label: string, description?: string) =>
  fields.text({ label, description });

/** Required multi-line string. */
const textArea = (label: string, description?: string) =>
  fields.text({ label, description, multiline: true, validation: { length: { min: 1 } } });

/** Optional multi-line string. */
const textAreaOpt = (label: string, description?: string) =>
  fields.text({ label, description, multiline: true });

/** List of plain strings. */
const stringList = (label: string, itemLabel: string, description?: string) =>
  fields.array(fields.text({ label: itemLabel }), {
    label,
    description,
    itemLabel: (props) => props.value || itemLabel,
  });

/** Button label + link, the shape TreeAbout / TreeCommercial expect. */
const ctaFields = (label: string) =>
  fields.object({ text: str('Label'), href: str('Link') }, { label });

/** List of paragraphs. */
const paragraphs = (label = 'Paragraphs') =>
  fields.array(fields.text({ label: 'Paragraph', multiline: true }), {
    label,
    itemLabel: (props) => props.value.slice(0, 60) || 'Paragraph',
  });

// ---------------------------------------------------------------------------
// Section shorthands — blocks that several pages share
// ---------------------------------------------------------------------------
const seo = fields.object(
  {
    title: str('Title'),
    description: textArea('Description'),
    keywords: stringList('Keywords', 'Keyword'),
  },
  { label: 'SEO' }
);

/**
 * SEO for services, where the block is genuinely optional. Keystatic always
 * writes an object for `fields.object` — it has no "omit this whole block"
 * switch the way Sveltia's `required: false` did — so blank is a legal value
 * here and the service page falls back to the title + card description.
 */
const seoOptional = fields.object(
  {
    title: strOpt('Title', 'Blank falls back to "<Service> — <Site name>".'),
    description: textAreaOpt('Description', 'Blank falls back to the card description.'),
    keywords: stringList('Keywords', 'Keyword'),
  },
  { label: 'SEO' }
);

// ---------------------------------------------------------------------------
// Global sections — one definition, rendered on many pages
// ---------------------------------------------------------------------------
// These seven blocks are the site's shared furniture: the trust bar, reviews,
// coverage list, FAQ, inspection form, emergency banner and project carousel.
//
// They used to be duplicated. The homepage owned a copy and the commercial,
// residential, about and projects pages each owned another, so changing the FAQ
// meant changing it in five places — and the copies had already drifted (three
// byte-identical sets of the same five project photos, in three folders). Each
// is now a singleton of its own under "Global Sections" in the CMS, and every
// page reads that one entry: edit it once, it changes everywhere it appears.
//
// Each is a FIELD MAP rather than a `fields.object`, because a singleton's
// `schema` takes its fields at the top level. That also keeps the form flat —
// one screen per section, with nothing to expand first.

const trustBarSection = {
  slogan: str('Slogan'),
  phoneNumber: str('Phone Number'),
  phoneLabel: strOpt('Phone Label'),
  alertIconSrc: scopedIcon('global/trust-bar')({ label: 'Alert Icon', required: true }),
  alertIconAlt: str('Alert Icon Alt Text'),
};

const testimonialsSection = {
  eyebrow: str('Eyebrow'),
  heading: str('Heading'),
  description: textArea('Description'),
  rating: fields.object(
    {
      score: str('Score'),
      caption: str('Caption'),
    },
    { label: 'Rating' }
  ),
  serviceRating: fields.object(
    {
      score: strOpt('Score', 'Leave blank for the logo-and-caption-only badge.'),
      caption: str('Caption'),
    },
    { label: 'Service Pages Badge', description: 'The reviews badge shown on service detail pages.' }
  ),
  reviews: fields.array(
    fields.object({
      title: str('Title'),
      quote: textArea('Quote'),
      name: str('Name'),
    }),
    { label: 'Reviews', itemLabel: (props) => props.fields.name.value || 'Review' }
  ),
};

const serviceAreasSection = {
  eyebrow: str('Eyebrow'),
  heading: str('Heading'),
  description: textArea('Description'),
  areasLabel: str('Areas Label'),
  areas: stringList('Areas', 'Area'),
  ctaText: str('CTA Text'),
};

const faqSection = {
  eyebrow: str('Eyebrow'),
  titleLead: str('Title (bold line)'),
  titleRest: str('Title (second line)'),
  subtitle: textAreaOpt('Subtitle', 'Shown on the interior pages; the homepage omits it.'),
  items: fields.array(
    fields.object({
      question: str('Question'),
      answer: textArea('Answer'),
    }),
    { label: 'Questions', itemLabel: (props) => props.fields.question.value || 'Question' }
  ),
};

const inspectionSection = {
  heading: str('Heading'),
  lead: textArea('Lead'),
  paragraphs: paragraphs(),
};

const emergencySection = {
  heading: str('Heading'),
  subtext: textArea('Subtext'),
  phoneLabel: str('Phone Label'),
  phoneNumber: str('Phone Number'),
};

const projectsSection = {
  eyebrow: str('Eyebrow'),
  heading: str('Heading'),
  description: textArea('Description'),
  items: fields.array(
    fields.object({
      image: scopedPhoto('global/projects')({ label: 'Photo', required: true }),
      alt: str('Alt Text'),
    }),
    { label: 'Project Photos', itemLabel: (props) => props.fields.alt.value || 'Photo' }
  ),
};

const statsList = fields.array(
  fields.object({
    value: str('Value'),
    label: str('Label'),
  }),
  { label: 'Stats Row', itemLabel: (props) => props.fields.label.value || 'Stat' }
);

/** The split hero band used by every interior page. */
const pageHero = (scope: string, opts: { imageSplit?: boolean; minHeight?: boolean } = {}) =>
  fields.object(
    {
      title: str('Title'),
      description: textAreaOpt('Description'),
      image: scopedPhoto(scope)({ label: 'Photo', required: true }),
      imageAlt: str('Photo Alt Text'),
      ...(opts.imageSplit
        ? {
            imageSplit: strOpt(
              'Photo Start (desktop)',
              'How far across the hero the photo begins, e.g. 56.72%. Leave blank for the 53.75% default.'
            ),
          }
        : {}),
      ...(opts.minHeight
        ? { minHeight: strOpt('Band Height', 'e.g. 396px. Blank uses the standard 551px hero.') }
        : {}),
    },
    { label: 'Page Hero' }
  );

// ---------------------------------------------------------------------------
// Business facts — the single source of truth for this client
// ---------------------------------------------------------------------------
// Ported from business.json. Every fact the site states about the business
// lives HERE and nowhere else: components read it, they never carry business
// facts of their own. A blank / null value means "not verified" — anything
// rendering one must hide the element rather than print a placeholder.
//
// Deliberately NOT duplicated here: the site name, logo and site URL (already
// at the top of this singleton) and the header/footer phone + address strings
// (below) — those are display copy, this block is the record.
/** Optional URL — writes null when blank, matching the "not verified" convention. */
const urlOpt = (label: string, description?: string) =>
  fields.url({ label, description });

/** Optional number — writes null when blank. */
const numOpt = (label: string, description?: string) =>
  fields.number({ label, description });

const businessSection = fields.object(
  {
    identity: fields.object(
      {
        legalName: strOpt('Legal Name', 'Registered entity, e.g. "… LLC".'),
        tagline: str('Tagline', 'Used by the {tagline} token in the SEO title patterns.'),
        foundedYear: numOpt('Founded Year', 'Years of experience is derived from this — never hardcoded.'),
        owner: strOpt('Owner'),
        teamSize: numOpt('Team Size', 'Blank = not verified.'),
        description: textArea('Business Description'),
      },
      { label: 'Identity' }
    ),
    contact: fields.object(
      {
        phone: str('Phone'),
        emergencyPhone: strOpt('Emergency Phone'),
        email: str('Email'),
      },
      {
        label: 'Contact',
        description: 'tel: links and the E.164 form are derived at build time — never stored twice.',
      }
    ),
    address: fields.object(
      {
        street: str('Street'),
        city: str('City'),
        state: str('State'),
        zip: str('ZIP'),
        county: strOpt('County'),
        country: str('Country', 'Two-letter code, e.g. US.'),
        lat: numOpt('Latitude'),
        lng: numOpt('Longitude'),
      },
      { label: 'Address' }
    ),
    hours: fields.object(
      {
        regular: fields.array(
          fields.object({
            days: stringList('Days', 'Day', 'Two-letter codes: Mo, Tu, We, Th, Fr, Sa, Su.'),
            opens: str('Opens', '24h time, e.g. 09:00.'),
            closes: str('Closes', '24h time, e.g. 18:00.'),
          }),
          {
            label: 'Regular Hours',
            itemLabel: (props) =>
              `${props.fields.opens.value}–${props.fields.closes.value}` || 'Hours',
          }
        ),
        closedDays: stringList('Closed Days', 'Day'),
        emergency247: fields.checkbox({ label: '24/7 emergency line', defaultValue: true }),
        emergencyNote: strOpt('Emergency Note'),
      },
      {
        label: 'Hours',
        description: 'No response-time promise anywhere — the client would not commit to one.',
      }
    ),
    serviceArea: fields.object(
      {
        primaryCity: str('Primary City', 'Fills the {primaryCity} token in the SEO title patterns.'),
      },
      {
        label: 'Service Area',
        description: 'Cities served get their own model once the location pages exist.',
      }
    ),
    trust: fields.object(
      {
        licensedAndInsured: fields.checkbox({ label: 'Licensed and insured', defaultValue: true }),
        licenseNumbers: stringList(
          'License Numbers',
          'Number',
          'Leave empty to keep copy generic ("fully licensed and insured").'
        ),
        certifications: stringList('Certifications', 'Certification', 'Only named, confirmed credentials.'),
        warranty: strOpt('Warranty'),
        seniorDiscount: strOpt('Senior Discount'),
        freeEstimates: fields.checkbox({ label: 'Free estimates', defaultValue: true }),
        projectsCompleted: numOpt('Projects Completed'),
        bbbRating: strOpt('BBB Rating'),
        bbbUrl: urlOpt('BBB URL'),
        equipment: stringList('Equipment', 'Item'),
        paymentAccepted: stringList('Payment Accepted', 'Method'),
        financing: strOpt('Financing'),
      },
      { label: 'Trust' }
    ),
    reviews: fields.object(
      {
        ratingValue: numOpt('Rating Value', 'e.g. 4.9. This is the number shown on the page.'),
        reviewCount: numOpt(
          'Review Count',
          'Blank until the reviews genuinely exist — aggregateRating is only emitted once this is set.'
        ),
        reviewSource: strOpt('Review Source'),
        reviewUrl: urlOpt('Review URL'),
      },
      { label: 'Reviews' }
    ),
    social: fields.object(
      {
        facebook: urlOpt('Facebook'),
        instagram: urlOpt('Instagram'),
        googleBusinessProfile: urlOpt('Google Business Profile'),
        tiktok: urlOpt('TikTok'),
        youtube: urlOpt('YouTube'),
        linkedin: urlOpt('LinkedIn'),
        yelp: urlOpt('Yelp'),
        angi: urlOpt('Angi'),
        bbb: urlOpt('BBB'),
        nextdoor: urlOpt('Nextdoor'),
      },
      {
        label: 'Social Profiles',
        description: 'The record used for schema sameAs. The footer icon row is edited under Footer.',
      }
    ),
    technical: fields.object(
      {
        locale: str('Locale', 'e.g. en-US.'),
        timezone: str('Timezone', 'IANA name, e.g. America/New_York.'),
        gtmId: strOpt('GTM Container ID'),
        ga4Id: strOpt('GA4 Measurement ID'),
        turnstileSiteKey: strOpt(
          'Turnstile Site Key',
          'Public key from Cloudflare → Turnstile. Renders the anti-spam widget on every form. ' +
            'Leave empty only if TURNSTILE_SECRET is also unset on the worker — a secret with no ' +
            'site key rejects every submission.'
        ),
        mediaBaseUrl: urlOpt(
          'Media Bucket URL',
          'Public origin of the R2 bucket that stores uploaded photos, e.g. ' +
            'https://media.example.com or the bucket\'s r2.dev address. Every uploaded ' +
            'image is served from here and re-encoded from here at build time, so ' +
            'changing it takes effect on the next deploy — and leaving it empty means ' +
            'uploads cannot be displayed.'
        ),
        defaultOgImage: photo({
          label: 'Default OG Image',
          description: '1200×630 social share image used when a page sets none.',
        }),
        schemaType: str('Schema Type', 'schema.org type, e.g. HomeAndConstructionBusiness.'),
        additionalType: urlOpt('Additional Type', 'schema.org additionalType URL.'),
        priceRange: strOpt('Price Range', 'e.g. $$.'),
        googlePlaceId: strOpt('Google Place ID'),
      },
      { label: 'Technical' }
    ),
  },
  { label: 'Business' }
);

// ---------------------------------------------------------------------------
// SEO — title patterns, length limits and per-URL overrides
// ---------------------------------------------------------------------------
// Titles are generated from these patterns rather than written per page, so the
// whole site stays consistent when the city, brand or tagline changes.
// Precedence:  Override (by URL)  >  Pattern  >  the page's own SEO title.
// Tokens: {name} {legalName} {tagline} {primaryCity} {city} {state} {county}
//         {phone} {email} plus {service} on service pages and {title} on posts.
const seoSection = fields.object(
  {
    patterns: fields.object(
      {
        home: strOpt('Home', 'Blank falls back to the page’s own SEO title.'),
        service: strOpt('Single Service', 'Tokens include {service}.'),
        servicesIndex: strOpt('Residential Services'),
        commercial: strOpt('Commercial Services'),
        post: strOpt('Blog Post', 'Tokens include {title}.'),
        about: strOpt('About'),
        contact: strOpt('Contact'),
        locations: strOpt('Service Areas Hub', 'Tokens include {stateName}.'),
        locationState: strOpt('State Page', 'Tokens include {stateName}.'),
        locationCounty: strOpt('County Page', 'Tokens include {county} {stateName}.'),
        locationCity: strOpt('City Page', 'Tokens include {city} {county} {stateName}.'),
        locationCityService: strOpt('Service In A City', 'Tokens include {service} {city}.'),
      },
      {
        label: 'Title Patterns',
        description:
          'Tokens: {name} {legalName} {tagline} {primaryCity} {city} {state} {county} {phone} {email}, plus {service} and {title}. On Service Areas pages {city} {county} {state} {stateName} follow the page.',
      }
    ),
    limits: fields.object(
      {
        titleMax: fields.integer({
          label: 'Title Max Length',
          defaultValue: 60,
          description:
            'Over-length titles are reported as a build warning and left intact — cutting one would strip the brand off the end.',
          validation: { isRequired: true },
        }),
        descriptionMax: fields.integer({
          label: 'Description Max Length',
          defaultValue: 155,
          description: 'Over-length descriptions are trimmed at the nearest word.',
          validation: { isRequired: true },
        }),
      },
      { label: 'Limits' }
    ),
    overrides: fields.array(
      fields.object({
        path: str('URL Path', 'Exactly as it appears in the address bar, e.g. /services/residential/.'),
        title: strOpt('Title', 'Blank keeps the pattern.'),
        description: textAreaOpt('Description', 'Blank keeps the page’s own description.'),
      }),
      {
        label: 'Per-page Overrides',
        itemLabel: (props) => props.fields.path.value || 'Override',
      }
    ),
  },
  { label: 'SEO' }
);

// ---------------------------------------------------------------------------
export default config({
  storage,

  ui: {
    brand: { name: "Erick's Tree Service" },
    navigation: {
      Content: [
        'homepage',
        'about',
        'servicesResidential',
        'servicesCommercial',
        'projects',
        'contact',
        'notFound',
      ],
      Services: ['services'],
      'Service Areas': ['serviceAreas', 'locations'],
      Blog: ['blogPage', 'posts'],
      Forms: ['forms', 'submissions'],
      // Edited once, rendered on every page that includes them.
      'Global Sections': [
        'globalTrustBar',
        'globalTestimonials',
        'globalServiceAreas',
        'globalFaq',
        'globalInspection',
        'globalEmergency',
        'globalProjects',
      ],
      Settings: ['settings', 'headerFooter'],
    },
  },

  // -------------------------------------------------------------------------
  // Singletons — one file each.
  // -------------------------------------------------------------------------
  singletons: {
    // -----------------------------------------------------------------------
    // Site Settings — global chrome (logo, header, footer, contact, theme).
    // Reused across every page of the site.
    // -----------------------------------------------------------------------
    settings: singleton({
      label: 'Site Settings',
      path: 'src/content/settings/site',
      format: { data: 'json' },
      schema: {
        // Single source of truth for the domain. astro.config.mjs reads it into
        // `site`, so canonical, og:url, the sitemap and robots.txt all follow.
        // Changing it requires a rebuild (or a dev-server restart).
        siteUrl: fields.text({
          label: 'Site URL',
          validation: {
            length: { min: 1 },
            pattern: {
              regex: /^https?:\/\/[^/]+$/,
              message: 'Full origin with no trailing slash, e.g. https://www.example.com',
            },
          },
        }),
        siteName: str('Site Name'),
        // Logos and icons stay in public/ as-is: they are vectors (or flat
        // raster marks), not photographs, and never go through <Picture />.
        logo: mediaFile({ label: 'Logo', required: true }),
        // Browser tab icon. The MIME type is derived from the extension at
        // render time, so an .svg, .png or .ico upload all just work.
        favicon: rootFile({
          label: 'Favicon',
          description: 'Browser tab icon — SVG, PNG or ICO. Square, 32px or larger.',
          required: true,
        }),
        business: businessSection,
        seo: seoSection,
        theme: fields.object(
          {
            colors: fields.object(
              {
                textPrimary: str('Text Primary'),
                textAccent: str('Text Accent'),
                bgBrand: str('Brand'),
                bgBrandStrong: str('Brand Strong'),
                bgAccent: str('Accent'),
                bgAction: str('Action'),
                bgActionHover: str('Action Hover'),
                bgEmergency: str('Emergency'),
              },
              { label: 'Colors', description: 'Hex values, e.g. #013b2d.' }
            ),
            fonts: fields.object({ sans: str('Font Family') }, { label: 'Fonts' }),
          },
          { label: 'Theme' }
        ),
      },
    }),

    // -----------------------------------------------------------------------
    // Header & Footer — the site chrome, on a screen of its own so the two
    // menus are edited without scrolling past every other global setting.
    //
    // Keystatic derives an image's path from the FIELD path alone (see the note
    // on `scopedPhoto` above), so moving these out of Site Settings left every
    // badge and social icon exactly where it already was.
    // -----------------------------------------------------------------------
    headerFooter: singleton({
      label: 'Header & Footer',
      path: 'src/content/settings/header-footer',
      format: { data: 'json' },
      schema: {
        header: fields.object(
          {
            navigation: fields.array(
              fields.object({
                label: str('Label'),
                href: str('Link'),
                caret: fields.checkbox({ label: 'Dropdown caret', defaultValue: false }),
                // Optional second level. Any item with at least one submenu
                // entry renders a dropdown on desktop and an expandable
                // accordion inside the mobile panel.
                submenu: fields.array(
                  fields.object({
                    label: str('Label'),
                    href: str('Link'),
                  }),
                  { label: 'Submenu', itemLabel: (props) => props.fields.label.value || 'Submenu Item' }
                ),
              }),
              { label: 'Navigation', itemLabel: (props) => props.fields.label.value || 'Menu Item' }
            ),
            phone: fields.object(
              {
                number: str('Number'),
                label: strOpt('Label'),
              },
              { label: 'Phone' }
            ),
            ctaText: str('CTA Text'),
            ctaHref: str('CTA Link'),
          },
          { label: 'Header' }
        ),
        footer: fields.object(
          {
            description: textArea('Description'),
            badges: fields.array(
              fields.object({
                src: badge({ label: 'Image', required: true }),
                alt: str('Alt'),
                width: fields.integer({ label: 'Width', validation: { isRequired: true } }),
                height: fields.integer({ label: 'Height', validation: { isRequired: true } }),
              }),
              { label: 'Trust Badges', itemLabel: (props) => props.fields.alt.value || 'Badge' }
            ),
            social: fields.array(
              fields.object({
                platform: str('Platform'),
                url: str('URL'),
                icon: mediaFile({ label: 'Icon', required: true }),
              }),
              { label: 'Social Links', itemLabel: (props) => props.fields.platform.value || 'Social' }
            ),
            columns: fields.array(
              fields.object({
                title: str('Title'),
                links: fields.array(
                  fields.object({
                    label: str('Label'),
                    href: str('Link'),
                  }),
                  { label: 'Links', itemLabel: (props) => props.fields.label.value || 'Link' }
                ),
              }),
              { label: 'Link Columns', itemLabel: (props) => props.fields.title.value || 'Column' }
            ),
            contact: fields.object(
              {
                phone: str('Phone'),
                email: str('Email'),
                address: str('Address'),
              },
              { label: 'Contact' }
            ),
            emergency: fields.object(
              {
                label: str('Label'),
                number: str('Number'),
              },
              { label: 'Emergency' }
            ),
            copyright: str('Copyright'),
            legalLinks: fields.array(
              fields.object({
                label: str('Label'),
                href: str('Link'),
              }),
              { label: 'Legal Links', itemLabel: (props) => props.fields.label.value || 'Link' }
            ),
          },
          { label: 'Footer' }
        ),
      },
    }),

    // -----------------------------------------------------------------------
    // Global Sections — the shared furniture. One entry each; every page that
    // renders the section reads this entry, so an edit here lands everywhere.
    // -----------------------------------------------------------------------
    globalTrustBar: singleton({
      label: 'Trust Bar',
      path: 'src/content/global/trust-bar',
      format: { data: 'json' },
      schema: trustBarSection,
    }),

    globalTestimonials: singleton({
      label: 'Testimonials',
      path: 'src/content/global/testimonials',
      format: { data: 'json' },
      schema: testimonialsSection,
    }),

    globalServiceAreas: singleton({
      label: 'Service Areas',
      path: 'src/content/global/service-areas',
      format: { data: 'json' },
      schema: serviceAreasSection,
    }),

    globalFaq: singleton({
      label: 'FAQ',
      path: 'src/content/global/faq',
      format: { data: 'json' },
      schema: faqSection,
    }),

    globalInspection: singleton({
      label: 'Inspection Form',
      path: 'src/content/global/inspection',
      format: { data: 'json' },
      schema: inspectionSection,
    }),

    globalEmergency: singleton({
      label: 'Emergency Banner',
      path: 'src/content/global/emergency',
      format: { data: 'json' },
      schema: emergencySection,
    }),

    globalProjects: singleton({
      label: 'Projects',
      path: 'src/content/global/projects',
      format: { data: 'json' },
      schema: projectsSection,
    }),

    // -----------------------------------------------------------------------
    // Homepage — per-section editable content.
    // -----------------------------------------------------------------------
    homepage: singleton({
      label: 'Homepage',
      path: 'src/content/homepage/home',
      format: { data: 'json' },
      schema: {
        seo,
        hero: fields.object(
          {
            eyebrow: str('Eyebrow'),
            headline: str('Headline'),
            reviewText: str('Review Text'),
            subcopy: textArea('Subcopy'),
            bullets: stringList('Bullets', 'Bullet'),
            primaryCta: fields.object(
              {
                label: str('Label'),
                sublabel: strOpt('Sub-label'),
                href: str('Link'),
              },
              { label: 'Primary CTA' }
            ),
            phone: fields.object(
              {
                label: strOpt('Label'),
                number: str('Number'),
              },
              { label: 'Phone' }
            ),
            backgroundImage: scopedPhoto('homepage')({ label: 'Background Image (desktop)', required: true }),
            backgroundImageMobile: scopedPhoto('homepage')({ label: 'Background Image (mobile/tablet)', required: true }),
            badges: fields.array(
              fields.object({
                src: badge({ label: 'Image', required: true }),
                alt: str('Alt'),
                width: fields.integer({ label: 'Width', validation: { isRequired: true } }),
                height: fields.integer({ label: 'Height', validation: { isRequired: true } }),
              }),
              { label: 'Trust Badges', itemLabel: (props) => props.fields.alt.value || 'Badge' }
            ),
          },
          { label: 'Hero' }
        ),
        // Trust Bar, Projects, Emergency Banner, Testimonials, FAQ, Service
        // Areas and the Inspection Form all live under Global Sections now.
        // Service cards are generated from the Single Service collection —
        // edit a card by editing its service there, not here.
        services: fields.object(
          {
            eyebrow: str('Eyebrow'),
            heading: str('Heading'),
          },
          { label: 'Services', description: 'Cards come from the Single Service collection.' }
        ),
        about: fields.object(
          {
            eyebrow: str('Eyebrow'),
            heading: str('Heading'),
            paragraphs: paragraphs(),
            primaryCta: ctaFields('Primary Button'),
            secondaryCta: ctaFields('Secondary Button'),
            photo: fields.object(
              {
                src: scopedPhoto('homepage')({ label: 'Photo', required: true }),
                alt: str('Photo Alt Text'),
                width: fields.integer({ label: 'Width', defaultValue: 616, validation: { isRequired: true } }),
                height: fields.integer({ label: 'Height', defaultValue: 566, validation: { isRequired: true } }),
              },
              { label: 'Photo' }
            ),
            review: fields.object(
              {
                name: str('Reviewer Name'),
                quote: textArea('Quote'),
                avatarSrc: scopedPhoto('homepage')({ label: 'Reviewer Photo', required: true }),
                avatarAlt: str('Reviewer Photo Alt Text'),
                starsSrc: icon({ label: 'Stars Image', required: true }),
                verifiedSrc: icon({ label: 'Verified Badge', required: true }),
                sourceSrc: icon({ label: 'Review Source Logo', required: true }),
                sourceAlt: str('Review Source Alt Text'),
              },
              { label: 'Review Card' }
            ),
          },
          { label: 'About Us' }
        ),
        commercial: fields.object(
          {
            eyebrow: str('Eyebrow'),
            heading: str('Heading'),
            paragraphs: paragraphs(),
            primaryCta: ctaFields('Primary Button'),
            secondaryCta: ctaFields('Secondary Button'),
            photo: fields.object(
              {
                src: scopedPhoto('homepage')({ label: 'Photo', required: true }),
                alt: str('Photo Alt Text'),
              },
              { label: 'Photo' }
            ),
          },
          { label: 'Commercial Services' }
        ),
        whyChoose: fields.object(
          {
            eyebrow: str('Eyebrow'),
            heading: str('Heading'),
            items: fields.array(
              fields.object({
                // Rendered as a CSS mask-image — must resolve to a public URL.
                icon: icon({ label: 'Icon', required: true }),
                title: str('Title'),
                description: textArea('Description'),
              }),
              { label: 'Feature Cards', itemLabel: (props) => props.fields.title.value || 'Card' }
            ),
          },
          { label: 'Why Choose Us' }
        ),
        stats: fields.object(
          {
            eyebrow: str('Eyebrow'),
            heading: str('Heading'),
            items: fields.array(
              fields.object({
                value: str('Value'),
                label: str('Label'),
              }),
              { label: 'Stats', itemLabel: (props) => props.fields.label.value || 'Stat' }
            ),
          },
          { label: 'Stats Bar' }
        ),
        ctaBanner: fields.object(
          {
            headingLead: str('Heading Lead'),
            headingSub: str('Heading Sub'),
            primaryLabel: str('Button Label'),
            phoneNumber: str('Phone Number'),
          },
          { label: 'CTA Banner' }
        ),
        process: fields.object(
          {
            eyebrow: str('Eyebrow'),
            heading: str('Heading'),
            description: textArea('Description'),
            steps: fields.array(
              fields.object({
                number: str('Number'),
                icon: graphic({ label: 'Icon', required: true }),
                iconAlt: str('Icon Alt'),
                title: str('Title'),
                description: textArea('Description'),
              }),
              { label: 'Steps', itemLabel: (props) => props.fields.title.value || 'Step' }
            ),
          },
          { label: 'Process' }
        ),
        blog: fields.object(
          {
            eyebrow: str('Eyebrow'),
            title: str('Title'),
          },
          { label: 'Blog (heading)' }
        ),
      },
    }),

    // -----------------------------------------------------------------------
    // Commercial Services page — /services/commercial/.
    // Reuses the same section components as the homepage, but keeps its own
    // copy so the commercial page can diverge from the homepage.
    // -----------------------------------------------------------------------
    servicesCommercial: singleton({
      label: 'Commercial Services Page',
      path: 'src/content/pages/services-commercial',
      format: { data: 'json' },
      schema: {
        seo,
        hero: fields.object(
          {
            title: str('Title'),
            description: textArea('Description'),
            primaryCta: fields.object(
              {
                label: str('Label'),
                href: str('Link'),
              },
              { label: 'Primary Button' }
            ),
            separator: strOpt('Separator Word', 'Rendered between the two buttons — leave blank to hide.'),
            phoneCta: fields.object(
              {
                label: str('Label'),
                number: str('Number', 'Dialled number — the button links to tel: with this value.'),
              },
              { label: 'Phone Button' }
            ),
            image: scopedPhoto('services-commercial')({ label: 'Photo', required: true }),
            imageAlt: str('Photo Alt Text'),
          },
          { label: 'Page Hero' }
        ),
        stats: statsList,
        services: fields.object({ heading: str('Heading') }, {
          label: 'Services',
          description: 'Cards come from the Single Service collection.',
        }),
      },
    }),

    // -----------------------------------------------------------------------
    // Residential Services page — /services/residential/.
    // Same section components as the commercial page, plus a second card grid
    // ("Professional Outdoor Solutions") that only this page carries.
    // -----------------------------------------------------------------------
    servicesResidential: singleton({
      label: 'Residential Services Page',
      path: 'src/content/pages/services-residential',
      format: { data: 'json' },
      schema: {
        seo,
        hero: fields.object(
          {
            title: str('Title'),
            description: textArea('Description'),
            primaryCta: fields.object(
              {
                label: str('Label'),
                href: str('Link'),
              },
              { label: 'Primary Button' }
            ),
            separator: strOpt(
              'Separator Word',
              'Shown between the two buttons on desktop only — leave blank to hide.'
            ),
            phoneCta: fields.object(
              {
                label: str('Label'),
                number: str('Number', 'Dialled number — the button links to tel: with this value.'),
              },
              { label: 'Phone Button' }
            ),
            image: scopedPhoto('services-residential')({ label: 'Photo', required: true }),
            imageAlt: str('Photo Alt Text'),
            imageSplit: strOpt(
              'Photo Start (desktop)',
              'How far across the hero the photo begins, e.g. 56.72%. Leave blank for the 53.75% default.'
            ),
          },
          { label: 'Page Hero' }
        ),
        stats: statsList,
        services: fields.object({ heading: str('Heading') }, {
          label: 'Tree Services Grid',
          description: 'Cards come from the Single Service collection.',
        }),
        outdoor: fields.object({ heading: str('Heading') }, {
          label: 'Outdoor Solutions Grid',
          description: 'Cards come from the Single Service collection.',
        }),
      },
    }),

    // -----------------------------------------------------------------------
    // About Us page — /about/.
    // -----------------------------------------------------------------------
    about: singleton({
      label: 'About Us Page',
      path: 'src/content/pages/about',
      format: { data: 'json' },
      schema: {
        seo,
        hero: fields.object(
          {
            title: str('Title'),
            description: textAreaOpt('Description'),
            primaryCta: fields.object(
              {
                label: str('Label'),
                href: str('Link'),
              },
              { label: 'Primary Button' }
            ),
            separator: strOpt('Separator Word'),
            phoneCta: fields.object(
              {
                label: str('Label'),
                number: str('Number'),
              },
              { label: 'Phone Button' }
            ),
            image: scopedPhoto('about')({ label: 'Photo', required: true }),
            imageAlt: str('Photo Alt Text'),
            imageSplit: strOpt('Photo Start (desktop)'),
            minHeight: strOpt('Band Height', 'e.g. 396px. Blank uses the standard 551px hero.'),
          },
          { label: 'Page Hero' }
        ),
        story: fields.object(
          {
            eyebrow: strOpt('Eyebrow'),
            heading: str('Heading'),
            paragraphs: paragraphs(),
            ctaLabel: strOpt('Button Label'),
            ctaHref: strOpt('Button Link'),
            image: scopedPhoto('about')({ label: 'Photo', required: true }),
            imageAlt: str('Photo Alt Text'),
          },
          { label: 'Our Story' }
        ),
        stats: fields.object(
          {
            eyebrow: str('Eyebrow'),
            heading: str('Heading'),
            items: fields.array(
              fields.object({
                value: str('Value'),
                label: str('Label'),
              }),
              { label: 'Stats', itemLabel: (props) => props.fields.label.value || 'Stat' }
            ),
          },
          { label: 'Stats Bar' }
        ),
        approach: fields.object(
          {
            eyebrow: strOpt('Eyebrow'),
            heading: str('Heading'),
            description: textAreaOpt('Description'),
            badges: fields.array(
              fields.object({
                src: badge({ label: 'Badge', required: true }),
                alt: str('Alt Text'),
              }),
              { label: 'Accreditation Badges', itemLabel: (props) => props.fields.alt.value || 'Badge' }
            ),
            ctaLabel: strOpt('Button Label'),
            ctaHref: strOpt('Button Link'),
            image: scopedPhoto('about')({ label: 'Photo', required: true }),
            imageAlt: str('Photo Alt Text'),
          },
          { label: 'Our Approach' }
        ),
        mission: fields.object(
          {
            heading: str('Heading'),
            description: textAreaOpt('Description'),
            backgroundImage: scopedPhoto('about')({ label: 'Background Photo', required: true }),
            backgroundImageAlt: strOpt(
              'Background Alt Text',
              'Leave blank if the photo is purely decorative.'
            ),
          },
          { label: 'Our Mission' }
        ),
        coreValues: fields.object(
          {
            eyebrow: strOpt('Eyebrow'),
            heading: strOpt('Heading'),
            items: fields.array(
              fields.object({
                icon: icon({ label: 'Icon', required: true }),
                title: str('Title'),
                description: textArea('Description'),
              }),
              { label: 'Values', itemLabel: (props) => props.fields.title.value || 'Value' }
            ),
          },
          { label: 'Core Values' }
        ),
      },
    }),

    // -----------------------------------------------------------------------
    // Blog page — /blog/. Only the page chrome lives here; the posts
    // themselves are the Blog Posts collection.
    // -----------------------------------------------------------------------
    blogPage: singleton({
      label: 'Blog Page',
      path: 'src/content/pages/blog',
      format: { data: 'json' },
      schema: {
        seo,
        hero: pageHero('blog', { imageSplit: true }),
        recentHeading: str('Lead Row Heading', 'Above the first two posts.'),
        allHeading: str('Listing Heading', 'Above the remaining posts.'),
        emptyMessage: str('Empty Message', 'Shown when no posts are published.'),
        fallbackImage: scopedPhoto('blog')({
          label: 'Fallback Photo',
          description: 'Used for posts with no featured image.',
          required: true,
        }),
      },
    }),

    // -----------------------------------------------------------------------
    // Contact page — /contact/. The quote form itself is the shared Forms
    // model; only the hero copy, photo and the Find Us details live here.
    // -----------------------------------------------------------------------
    contact: singleton({
      label: 'Contact Page',
      path: 'src/content/pages/contact',
      format: { data: 'json' },
      schema: {
        seo,
        hero: pageHero('contact', { imageSplit: true, minHeight: true }),
        details: fields.object(
          {
            heading: str('Heading'),
            rows: fields.array(
              fields.object({
                icon: icon({ label: 'Icon', required: true }),
                label: str('Label'),
                href: strOpt('Link', 'tel:, mailto: or a maps URL. Leave blank for plain text.'),
              }),
              { label: 'Contact Rows', itemLabel: (props) => props.fields.label.value || 'Row' }
            ),
            emergency: fields.object(
              {
                icon: icon({ label: 'Icon' }),
                title: str('Title'),
                text: textArea('Text', 'Shown before the highlighted phone number.'),
                phone: str('Phone'),
                phoneHref: strOpt('Phone Link'),
              },
              { label: 'Emergency Card' }
            ),
            followLabel: str('Follow Label'),
            socials: fields.array(
              fields.object({
                platform: str('Platform'),
                url: str('URL'),
                icon: mediaFile({ label: 'Icon', required: true }),
              }),
              { label: 'Social Links', itemLabel: (props) => props.fields.platform.value || 'Social' }
            ),
            mapEmbedUrl: strOpt(
              'Map Embed URL',
              'Google Maps embed URL (Share → Embed a map → copy the src).'
            ),
            mapTitle: strOpt('Map Title', 'Describes the map for screen readers.'),
          },
          { label: 'Find Us' }
        ),
      },
    }),

    // -----------------------------------------------------------------------
    // Projects page — /projects/. A masonry photo gallery plus the shared FAQ
    // and inspection-form sections.
    // -----------------------------------------------------------------------
    projects: singleton({
      label: 'Projects Page',
      path: 'src/content/pages/projects',
      format: { data: 'json' },
      schema: {
        seo,
        hero: fields.object(
          {
            title: str('Title'),
            image: scopedPhoto('projects')({ label: 'Photo', required: true }),
            imageAlt: str('Photo Alt Text'),
            imageSplit: strOpt(
              'Photo Start (desktop)',
              'e.g. 56.98%. Leave blank for the 53.75% default.'
            ),
          },
          { label: 'Page Hero' }
        ),
        gallery: fields.object(
          {
            initialCount: fields.integer({
              label: 'Photos Before "Load More"',
              defaultValue: 8,
              description: 'Set to 0 to show every photo with no button.',
              validation: { isRequired: true },
            }),
            loadMoreLabel: str('Load More Button Label'),
            items: fields.array(
              fields.object({
                image: scopedPhoto('projects')({ label: 'Photo', required: true }),
                alt: str('Alt Text'),
              }),
              { label: 'Photos', itemLabel: (props) => props.fields.alt.value || 'Photo' }
            ),
          },
          { label: 'Gallery' }
        ),
      },
    }),

    // -----------------------------------------------------------------------
    // Service Areas settings — everything the locations tree shares.
    //
    // The hub page (/locations/) and its state and county variants all render
    // from this one file: the copy below is written with {state}, {county} and
    // {city} tokens that each page fills in. `services` is the list of services
    // offered in EVERY town — it drives the hub cards, the third level of the
    // "Areas We Serve" menu, and which service×city pages get built.
    // -----------------------------------------------------------------------
    serviceAreas: singleton({
      label: 'Service Areas Settings',
      path: 'src/content/settings/locations',
      format: { data: 'json' },
      schema: {
        services: fields.array(
          fields.relationship({
            label: 'Service',
            collection: 'services',
            validation: { isRequired: true },
          }),
          {
            label: 'Services Offered In Every Town',
            description:
              'Each one becomes a link on every town card, a row in the menu, and a service×city page.',
            itemLabel: (props) => props.value || 'Service',
          }
        ),
        hub: fields.object(
          {
            seo,
            hero: pageHero('service-areas', { imageSplit: true }),
            eyebrow: str('Section Eyebrow'),
            heading: str('Section Heading', 'Tokens: {state} {county} {name}.'),
            description: textArea('Section Lead'),
            footnote: textAreaOpt(
              'Closing Note',
              'Under the cards. Tokens: {state} {county} {phone} {name}.'
            ),
          },
          { label: 'Locations Hub Page' }
        ),
        statePage: fields.object(
          {
            heroTitle: str('Hero Title', 'Tokens: {state} {stateAbbr} {name}.'),
            heroDescription: textAreaOpt('Hero Description'),
            heading: str('Section Heading'),
            description: textArea('Section Lead'),
            seoDescription: textArea('Meta Description'),
          },
          { label: 'State Page', description: 'e.g. /locations/connecticut/.' }
        ),
        countyPage: fields.object(
          {
            heroTitle: str('Hero Title', 'Tokens: {county} {state} {stateAbbr} {name}.'),
            heroDescription: textAreaOpt('Hero Description'),
            heading: str('Section Heading'),
            description: textArea('Section Lead'),
            seoDescription: textArea('Meta Description'),
          },
          { label: 'County Page', description: 'e.g. /locations/connecticut/fairfield-county/.' }
        ),
        cityDefaults: fields.object(
          {
            heroDescription: textAreaOpt('Hero Description', 'Used when a town leaves its hero blank.'),
            heroImage: scopedPhoto('service-areas')({ label: 'Hero Photo' }),
            heroImageAlt: strOpt('Hero Photo Alt Text'),
            introImage: scopedPhoto('service-areas')({ label: 'Intro Photo' }),
            introImageAlt: strOpt('Intro Photo Alt Text'),
            permitImage: scopedPhoto('service-areas')({ label: 'Permits & Pricing Photo' }),
            permitImageAlt: strOpt('Permits & Pricing Photo Alt Text'),
            ctaLabel: str('Button Label'),
            ctaHref: str('Button Link'),
          },
          {
            label: 'City Page Defaults',
            description: 'Fallbacks so a new town is publishable before its own photos exist.',
          }
        ),
        breadcrumbLabel: str('Breadcrumb Root Label', 'e.g. Service Areas.'),
      },
    }),

    // -----------------------------------------------------------------------
    // 404 page — served for any unknown URL. Same chrome (header/footer/theme)
    // and the same compact page hero every interior page uses; only the copy
    // and the helpful links live here.
    // -----------------------------------------------------------------------
    notFound: singleton({
      label: '404 Page',
      path: 'src/content/pages/404',
      format: { data: 'json' },
      schema: {
        seo,
        hero: pageHero('not-found', { imageSplit: true }),
        body: fields.object(
          {
            code: str('Code', 'The oversized number above the heading.'),
            heading: str('Heading'),
            description: textArea('Description'),
            primaryCta: fields.object(
              { label: str('Label'), href: str('Link') },
              { label: 'Primary Button' }
            ),
            secondaryCta: fields.object(
              {
                label: strOpt('Label', 'Leave blank to hide the second button.'),
                href: strOpt('Link'),
              },
              { label: 'Secondary Button' }
            ),
            linksHeading: strOpt('Links Heading'),
            links: fields.array(
              fields.object({ label: str('Label'), href: str('Link') }),
              { label: 'Helpful Links', itemLabel: (props) => props.fields.label.value || 'Link' }
            ),
          },
          { label: '404 Content' }
        ),
      },
    }),
  },

  // -------------------------------------------------------------------------
  // Collections — many files each.
  // -------------------------------------------------------------------------
  collections: {
    // -----------------------------------------------------------------------
    // Single Service — the source of truth for every service on the site.
    // One entry per service. The FILENAME is the slug its detail page is built
    // at (tree-removal.md -> /service/tree-removal/), and every services grid
    // on the site (homepage, /services/commercial/, /services/residential/) is
    // generated from this collection, so a card and its page can never drift
    // apart.
    //
    // Taxonomy: `categories` places a service under Residential and/or
    // Commercial; `group` picks which of the two grids it lands in on the
    // residential page. Keep in sync with `services` in src/content.config.ts.
    // -----------------------------------------------------------------------
    services: collection({
      label: 'Single Service',
      path: 'src/content/services/*',
      format: { data: 'yaml', contentField: 'content' },
      slugField: 'title',
      entryLayout: 'content',
      columns: ['title', 'order'],
      schema: {
        title: fields.slug({
          name: {
            label: 'Title',
            description:
              'Also becomes the URL slug for a new service, e.g. Tree Removal -> /service/tree-removal/.',
            validation: { length: { min: 1 } },
          },
        }),
        order: fields.integer({
          label: 'Order',
          defaultValue: 0,
          description: 'Ascending — controls position within a services grid.',
          validation: { isRequired: true },
        }),
        categories: fields.multiselect({
          label: 'Categories',
          options: [
            { label: 'Residential', value: 'residential' },
            { label: 'Commercial', value: 'commercial' },
          ],
          defaultValue: ['residential'],
          description:
            'Which services pages this service appears on. Pick both if it applies to both.',
        }),
        group: fields.select({
          label: 'Grid',
          options: [
            { label: 'Tree Services', value: 'tree-care' },
            { label: 'Outdoor Solutions', value: 'outdoor-solutions' },
          ],
          defaultValue: 'tree-care',
          description: 'Which grid the card sits in on the Residential Services page.',
        }),
        draft: fields.checkbox({
          label: 'Draft',
          defaultValue: false,
          description: 'Hides the service from every grid and unpublishes its page.',
        }),

        card: fields.object(
          {
            description: textArea('Description'),
            image: photo({ label: 'Photo', required: true }),
            icon: icon({ label: 'Icon', required: true }),
          },
          { label: 'Card', description: 'How this service appears in the services grids.' }
        ),

        seo: seoOptional,

        // Everything from here down is an OPTIONAL section. Keystatic writes an
        // object for every `fields.object`, so "this service has no hero" is
        // expressed by leaving the section's key field blank rather than by the
        // block being absent — the service page keys each section off the field
        // named in its description. Most services use none of these.
        hero: fields.object(
          {
            title: strOpt('Title', 'Blank falls back to "<Service> Services Across Connecticut".'),
            description: textAreaOpt('Description'),
            image: photo({ label: 'Photo', description: 'Leave empty to hide the hero entirely.' }),
            imageAlt: strOpt('Photo Alt Text'),
            imageSplit: strOpt(
              'Photo Start (desktop)',
              'e.g. 56.72%. Leave blank for the 53.75% default.'
            ),
          },
          { label: 'Page Hero', description: 'Shown only when a photo is set.' }
        ),

        intro: fields.object(
          {
            heading: strOpt('Heading', 'Leave empty to hide this section entirely.'),
            paragraphs: paragraphs(),
            ctaLabel: strOpt('Button Label'),
            ctaHref: strOpt('Button Link'),
            image: photo({ label: 'Photo' }),
            imageAlt: strOpt('Photo Alt Text'),
          },
          { label: 'Intro Block', description: 'Shown only when a heading is set.' }
        ),

        whyChooseHeading: strOpt(
          'Why Choose Us Heading',
          'Overrides the site-wide heading on this page only.'
        ),

        capabilities: fields.object(
          {
            heading: strOpt('Heading', 'Leave empty to hide this section entirely.'),
            intro: textAreaOpt('Intro'),
            bullets: fields.array(fields.text({ label: 'Bullet', multiline: true }), {
              label: 'Bullets',
              itemLabel: (props) => props.value.slice(0, 60) || 'Bullet',
            }),
            ctaLabel: strOpt('Button Label'),
            ctaHref: strOpt('Button Link'),
            chips: fields.array(
              fields.object({
                icon: icon({ label: 'Icon', required: true }),
                label: str('Label'),
              }),
              { label: 'Chips', itemLabel: (props) => props.fields.label.value || 'Chip' }
            ),
          },
          { label: 'What We Can Do For You', description: 'Shown only when a heading is set.' }
        ),

        checklist: fields.object(
          {
            heading: strOpt('Heading', 'Leave empty to hide this section entirely.'),
            intro: textAreaOpt('Intro'),
            items: stringList('Items', 'Item'),
          },
          { label: 'Criteria Checklist', description: 'Shown only when a heading is set.' }
        ),

        bodyImage: photo({
          label: 'Body Photo',
          description: 'Tall photo shown beside the article body below.',
        }),
        bodyImageAlt: strOpt('Body Photo Alt Text'),
        bodyCtaLabel: strOpt('Body Button Label'),
        bodyCtaHref: strOpt('Body Button Link'),

        // `extension: 'md'` keeps these as plain .md files so Astro's glob
        // loader renders them as Markdown — without it Keystatic would write
        // .mdoc and every service page would 404.
        content: fields.markdoc({
          label: 'Body',
          extension: 'md',
          description: 'Long-form content. Use H2 for the section headings.',
        }),
      },
    }),

    // -----------------------------------------------------------------------
    // Forms — a content model of their own, so a form can be authored once and
    // reused on any page. One JSON file per form; the FILENAME is the id a
    // page looks it up by (quote.json → getForm('quote') in src/lib/forms.ts),
    // so renaming a form's title never breaks a page. Editors can add new
    // forms and edit every field's label, placeholder and type.
    // -----------------------------------------------------------------------
    forms: collection({
      label: 'Forms',
      path: 'src/content/forms/*',
      format: { data: 'json' },
      slugField: 'name',
      columns: ['name'],
      schema: {
        name: fields.slug({
          name: {
            label: 'Form Name',
            description: 'Internal label — also becomes the file name for a new form.',
            validation: { length: { min: 1 } },
          },
        }),
        title: str('Title', 'Heading shown above the form.'),
        subtitle: textAreaOpt('Subtitle'),
        submitText: str('Submit Button Text'),
        action: fields.text({
          label: 'Action / Endpoint',
          defaultValue: '/api/quote',
          description: 'Where submissions are posted. Leads land in Form Submissions.',
          validation: { length: { min: 1 } },
        }),
        fields: fields.array(
          fields.object({
            name: str('Field Name (key)', 'Key the value is submitted under — e.g. full_name.'),
            type: fields.select({
              label: 'Type',
              options: [
                { label: 'Text', value: 'text' },
                { label: 'Email', value: 'email' },
                { label: 'Phone', value: 'tel' },
                { label: 'Textarea', value: 'textarea' },
                { label: 'Select', value: 'select' },
                { label: 'Radio', value: 'radio' },
              ],
              defaultValue: 'text',
              description: 'tel fields get country detection and phone validation automatically.',
            }),
            label: strOpt('Label'),
            placeholder: strOpt('Placeholder'),
            required: fields.checkbox({ label: 'Required', defaultValue: false }),
            options: stringList(
              'Options (select/radio)',
              'Option',
              'Only applies to select and radio field types.'
            ),
          }),
          {
            label: 'Fields',
            itemLabel: (props) =>
              `${props.fields.label.value || props.fields.name.value} (${props.fields.type.value})`,
          }
        ),
      },
    }),

    // -----------------------------------------------------------------------
    // Form submissions (leads) — written by the /api/quote endpoint.
    // Treat as read-only: Keystatic has no "create: false" switch, so the New
    // button is present, but nothing on the site reads entries you add by hand.
    // -----------------------------------------------------------------------
    submissions: collection({
      label: 'Form Submissions',
      path: 'src/content/submissions/*',
      format: { data: 'yaml', contentField: 'content' },
      slugField: 'name',
      columns: ['name', 'form', 'received'],
      schema: {
        name: fields.slug({ name: { label: 'Name' } }),
        form: strOpt('Form', 'Where on the site it was submitted.'),
        form_id: strOpt('Form Definition', 'Which entry in Forms produced these fields.'),
        email: strOpt('Email'),
        phone: strOpt('Phone'),
        received: strOpt('Received', 'ISO timestamp written by the form endpoint.'),
        // The answers are a LIST, not one frontmatter key per field, because
        // the fields themselves are editable in Forms. A key per field would
        // mean every field added there produced entries whose keys this schema
        // does not declare — and Keystatic refuses to open those at all
        // ("Key on object value is not allowed"). A list of label/value pairs
        // is one schema that fits any form, today's and tomorrow's.
        answers: fields.array(
          fields.object({
            name: strOpt('Field Name'),
            label: strOpt('Label'),
            type: strOpt('Type'),
            value: textAreaOpt('Value'),
          }),
          { label: 'Answers', itemLabel: (props) => props.fields.label.value || props.fields.name.value }
        ),
        content: fields.markdoc({ label: 'Message', extension: 'md' }),
      },
    }),

    // -----------------------------------------------------------------------
    // Blog Posts — /blog/<slug>/.
    // -----------------------------------------------------------------------
    posts: collection({
      label: 'Blog Posts',
      path: 'src/content/posts/*',
      format: { data: 'yaml', contentField: 'content' },
      slugField: 'title',
      entryLayout: 'content',
      columns: ['title', 'date'],
      schema: {
        title: fields.slug({ name: { label: 'Title', validation: { length: { min: 1 } } } }),
        date: fields.date({ label: 'Date', defaultValue: { kind: 'today' }, validation: { isRequired: true } }),
        description: textAreaOpt('Description'),
        image: photo({ label: 'Featured Image' }),
        imageAlt: strOpt('Image Alt Text'),
        draft: fields.checkbox({ label: 'Draft', defaultValue: false }),
        content: fields.markdoc({ label: 'Body', extension: 'md' }),
      },
    }),

    // -----------------------------------------------------------------------
    // Service Areas — one entry per CITY. This is the only level of the
    // locations tree that carries content: the hub (/locations/), the state
    // page and the county page are all generated by grouping these entries, so
    // adding a town creates its page, its four URL levels, its hub card and its
    // column in the "Areas We Serve" menu in one go.
    //
    //   /locations/{State Slug}/{County Slug}/{slug}/
    //   /locations/{State Slug}/{County Slug}/{slug}/{service}/   (per service)
    //
    // Keep in sync with the `locations` collection in src/content.config.ts.
    // -----------------------------------------------------------------------
    locations: collection({
      label: 'Service Areas',
      path: 'src/content/locations/*',
      format: { data: 'yaml', contentField: 'content' },
      slugField: 'title',
      entryLayout: 'content',
      columns: ['title', 'county', 'order'],
      schema: {
        title: fields.slug({
          name: {
            label: 'City',
            description: 'Also the URL slug — Bridgeport -> /locations/connecticut/fairfield-county/bridgeport/.',
            validation: { length: { min: 1 } },
          },
        }),
        stateAbbr: fields.text({
          label: 'State Abbreviation',
          defaultValue: 'CT',
          description: 'Shown on the hub cards and in page titles — "Bridgeport, CT".',
          validation: { length: { min: 1 } },
        }),
        state: fields.text({
          label: 'State',
          defaultValue: 'Connecticut',
          validation: { length: { min: 1 } },
        }),
        stateSlug: fields.text({
          label: 'State Slug',
          defaultValue: 'connecticut',
          description: 'Second URL segment. Same value for every city in that state.',
          validation: { length: { min: 1 } },
        }),
        county: fields.text({
          label: 'County',
          defaultValue: 'Fairfield County',
          validation: { length: { min: 1 } },
        }),
        countySlug: fields.text({
          label: 'County Slug',
          defaultValue: 'fairfield-county',
          description: 'Third URL segment. Same value for every city in that county.',
          validation: { length: { min: 1 } },
        }),
        order: fields.integer({
          label: 'Order',
          defaultValue: 0,
          description: 'Ascending — the order towns appear in the hub cards and the menu.',
          validation: { isRequired: true },
        }),
        draft: fields.checkbox({ label: 'Draft', defaultValue: false }),
        seo: seoOptional,
        hero: fields.object(
          {
            title: strOpt('Title', 'Blank falls back to "Tree Service in <City>, <ST>".'),
            description: textAreaOpt('Description'),
            image: photo({ label: 'Photo' }),
            imageAlt: strOpt('Photo Alt Text'),
            imageSplit: strOpt('Photo Start (desktop)', 'e.g. 56.98%. Blank uses the 53.75% default.'),
          },
          { label: 'Page Hero' }
        ),
        intro: fields.object(
          {
            heading: strOpt('Heading', 'e.g. "Why Bridgeport homeowners trust Erick\'s Tree Service".'),
            paragraphs: paragraphs(),
            ctaLabel: strOpt('Button Label'),
            ctaHref: strOpt('Button Link'),
            image: photo({ label: 'Photo' }),
            imageAlt: strOpt('Photo Alt Text'),
          },
          { label: 'Intro (photo left)' }
        ),
        servicesHeading: strOpt('Services Heading', 'Above the services grid, e.g. "Our Tree Services in Bridgeport, CT".'),
        problems: fields.object(
          {
            eyebrow: strOpt('Eyebrow'),
            heading: strOpt('Heading', 'e.g. "Common Tree Problems in Bridgeport, CT".'),
            items: fields.array(
              fields.object({
                icon: icon({ label: 'Icon', required: true }),
                title: str('Title'),
                description: textArea('Description'),
              }),
              { label: 'Problems', itemLabel: (props) => props.fields.title.value || 'Problem' }
            ),
          },
          { label: 'Local Problems' }
        ),
        permit: fields.object(
          {
            image: photo({ label: 'Photo' }),
            imageAlt: strOpt('Photo Alt Text'),
            ctaLabel: strOpt('Button Label'),
            ctaHref: strOpt('Button Link'),
          },
          {
            label: 'Permits & Pricing',
            description: 'The prose beside this photo is the Body field at the bottom of this entry.',
          }
        ),
        faq: fields.object(
          {
            eyebrow: strOpt('Eyebrow'),
            titleLead: strOpt('Title (bold line)'),
            titleRest: strOpt('Title (second line)'),
            subtitle: textAreaOpt('Subtitle'),
            items: fields.array(
              fields.object({
                question: str('Question'),
                answer: textArea('Answer'),
              }),
              { label: 'Questions', itemLabel: (props) => props.fields.question.value || 'Question' }
            ),
          },
          { label: 'FAQ', description: 'Leave the list empty to use the homepage FAQ.' }
        ),
        content: fields.markdoc({
          label: 'Permits & Pricing Body',
          extension: 'md',
          description: 'Long-form prose beside the Permits & Pricing photo — headings, paragraphs, lists.',
        }),
      },
    }),
  },
});
