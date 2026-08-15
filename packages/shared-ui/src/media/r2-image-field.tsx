/**
 * r2-image-field.tsx
 * ------------------
 * `r2Image()` — the replacement for `fields.image()` on a site whose media
 * lives in R2.
 *
 * Keystatic has no R2 field and no plugin API, but a field is just an object:
 * `kind: 'form'` plus parse/serialize/validate and a React `Input`. That is the
 * whole public contract (`BasicFormField`, exported from @keystatic/core), so
 * this is a first-class field rather than a workaround — it sits inline in the
 * form, previews, validates and blocks Save exactly like the built-ins.
 *
 * What changes for an editor: nothing visible. What changes underneath: the
 * bytes go to the bucket over /api/media as soon as they are dropped, and the
 * entry stores `r2:<key>` instead of a repo path — so saving an entry commits a
 * one-line JSON diff instead of a 6 MB binary.
 *
 * The Keystatic footguns this removes, all of them documented in CLAUDE.md:
 *   - no more `<directory>/<field-path>/<index>/<key>.<ext>` path derivation,
 *     so array items stop fighting over filenames;
 *   - no more "two entries pointing at one file" — keys are content-addressed,
 *     so sharing an image is sharing a string;
 *   - no more relocation-on-save deleting the file another entry referenced.
 */
import type { BasicFormField } from '@keystatic/core';
import { R2ImageInput } from './R2ImageInput';

export interface R2ImageOptions<IsRequired extends boolean | undefined> {
  label: string;
  description?: string;
  /**
   * Folder inside the bucket, e.g. `photos/homepage`. Purely organisational —
   * unlike Keystatic's `directory`, nothing about resolution depends on it, so
   * renaming a prefix never orphans an existing image.
   */
  prefix?: string;
  /** Upload endpoint. Only ever changed by a site that mounts it elsewhere. */
  endpoint?: string;
  validation?: { isRequired?: IsRequired };
}

type Parsed = string | null;

export function r2Image<IsRequired extends boolean | undefined = undefined>({
  label,
  description,
  prefix = 'uploads',
  endpoint = '/api/media',
  validation,
}: R2ImageOptions<IsRequired>): BasicFormField<
  Parsed,
  IsRequired extends true ? string : Parsed,
  IsRequired extends true ? string : Parsed
> {
  const isRequired = validation?.isRequired === true;

  /** Empty string and absent are the same thing: no image. */
  const normalise = (value: unknown): Parsed =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

  const assertRequired = (value: Parsed) => {
    if (isRequired && value === null) {
      // Keystatic surfaces an invalid field by catching this — the Input paints
      // its own message once forceValidation flips.
      throw new Error(`${label} is required.`);
    }
    return value as IsRequired extends true ? string : Parsed;
  };

  return {
    kind: 'form',
    Input(props) {
      return (
        <R2ImageInput
          {...props}
          label={label}
          description={description}
          isRequired={isRequired}
          prefix={prefix}
          endpoint={endpoint}
        />
      );
    },
    defaultValue: () => null,
    parse: (value) => normalise(value),
    serialize: (value) => ({ value: normalise(value) ?? undefined }),
    validate: assertRequired,
    reader: { parse: (value) => assertRequired(normalise(value)) },
    label,
  };
}
