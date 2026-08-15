/**
 * R2ImageInput.tsx
 * ----------------
 * The editor-facing half of the `r2Image` field: pick or drop a file, watch it
 * upload to R2, see the preview. Everything Keystatic's own image field offers,
 * except the bytes end up in a bucket instead of a git commit.
 *
 * Styled with Keystatic's own `--kui-*` custom properties rather than its
 * component library. The tokens are already on the page (its provider sets
 * them), so the field inherits light/dark mode and spacing for free — without
 * this package taking a dependency on @keystar/ui, whose version is pinned to
 * whatever @keystatic/core resolved.
 *
 * BEFORE UPLOAD the browser re-encodes anything wider than 1920px, matching
 * `bun run import-photo`: an editor picking a 6000px photo off their phone
 * sends ~400 KB instead of 12 MB. PNGs with a live alpha channel and SVGs are
 * passed through untouched — re-encoding those loses what makes them the right
 * format.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface R2ImageInputProps {
  value: string | null;
  onChange(value: string | null): void;
  autoFocus?: boolean;
  forceValidation?: boolean;
  label: string;
  description?: string;
  isRequired?: boolean;
  /** Bucket folder for this field, e.g. `photos/homepage`. */
  prefix: string;
  /** Endpoint that signs and stores the upload. */
  endpoint: string;
}

/** Longest edge kept, mirroring the import-photo budget. */
const MAX_WIDTH = 1920;
const JPEG_QUALITY = 0.9;

const styles = {
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 'var(--kui-size-scale-100, 8px)',
  },
  label: {
    font: 'inherit',
    fontSize: 'var(--kui-typography-text-regular-size, 0.875rem)',
    fontWeight: 500,
    color: 'var(--kui-color-foreground-neutral-emphasis, inherit)',
  },
  description: {
    fontSize: 'var(--kui-typography-text-small-size, 0.75rem)',
    color: 'var(--kui-color-foreground-neutral-secondary, #666)',
  },
  dropzone: (active: boolean, invalid: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--kui-size-scale-150, 12px)',
    padding: 'var(--kui-size-scale-150, 12px)',
    borderRadius: 'var(--kui-size-radius-regular, 6px)',
    borderWidth: 'var(--kui-size-border-medium, 2px)',
    borderStyle: 'dashed',
    borderColor: invalid
      ? 'var(--kui-color-border-critical, #d92d20)'
      : active
        ? 'var(--kui-color-border-accent, #3b82f6)'
        : 'var(--kui-color-border-neutral, #d4d4d4)',
    background: active
      ? 'var(--kui-color-background-accent, transparent)'
      : 'var(--kui-color-background-canvas, transparent)',
    transition: 'border-color 150ms ease, background-color 150ms ease',
  }),
  thumb: {
    width: 96,
    height: 72,
    objectFit: 'contain' as const,
    borderRadius: 'var(--kui-size-radius-small, 4px)',
    background: 'var(--kui-color-background-surface-secondary, #f4f4f4)',
    flexShrink: 0,
  },
  body: { display: 'flex', flexDirection: 'column' as const, gap: 4, minWidth: 0, flex: 1 },
  key: {
    fontSize: 'var(--kui-typography-text-small-size, 0.75rem)',
    color: 'var(--kui-color-foreground-neutral-secondary, #666)',
    overflowWrap: 'anywhere' as const,
  },
  actions: { display: 'flex', gap: 'var(--kui-size-scale-100, 8px)', alignItems: 'center' },
  button: {
    font: 'inherit',
    fontSize: 'var(--kui-typography-text-small-size, 0.75rem)',
    padding: '4px 10px',
    borderRadius: 'var(--kui-size-radius-small, 4px)',
    border: '1px solid var(--kui-color-border-neutral, #d4d4d4)',
    background: 'var(--kui-color-background-surface, transparent)',
    color: 'var(--kui-color-foreground-neutral, inherit)',
    cursor: 'pointer',
  },
  error: {
    fontSize: 'var(--kui-typography-text-small-size, 0.75rem)',
    color: 'var(--kui-color-foreground-critical, #d92d20)',
  },
};

/** The `r2:` value, minus its sentinel — what the editor actually recognises. */
function keyOf(value: string | null): string {
  return value ? value.replace(/^r2:/, '') : '';
}

/**
 * Re-encode oversized rasters in the browser. Returns the original file when
 * shrinking it would be wrong (vector, animation, live transparency) or when
 * canvas is unavailable — never blocks the upload on its own failure.
 */
async function downscale(file: File): Promise<Blob> {
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  // A small PNG is likely a logo or an icon whose transparency is the point.
  const keepsAlpha = file.type === 'image/png' || file.type === 'image/webp';
  if (scale === 1 && (keepsAlpha || file.size <= 1024 * 1024)) {
    bitmap.close?.();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close?.();
    return file;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const type = keepsAlpha ? file.type : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, JPEG_QUALITY)
  );
  // Re-encoding is only worth it if it actually helped.
  return blob && blob.size < file.size ? blob : file;
}

export function R2ImageInput(props: R2ImageInputProps) {
  const { value, onChange, forceValidation, label, description, isRequired, prefix, endpoint } =
    props;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The stored value is a key, not a URL. Ask the endpoint what the public URL
  // is rather than duplicating the base here — the CMS bundle is built once and
  // the bucket domain is a deploy-time concern.
  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    // A field that has not been migrated yet still holds a repo path. Those are
    // served by the site itself, so they preview without asking anyone.
    if (!value.startsWith('r2:')) {
      setPreviewUrl(value.startsWith('/') ? value : null);
      return;
    }
    fetch(`${endpoint}?url=${encodeURIComponent(keyOf(value))}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { url?: string } | null) => {
        if (!cancelled) setPreviewUrl(body?.url ?? null);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, endpoint]);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const body = new FormData();
        const blob = await downscale(file);
        body.set('file', new File([blob], file.name, { type: blob.type || file.type }));
        body.set('prefix', prefix);

        const response = await fetch(endpoint, { method: 'POST', body });
        const result = (await response.json().catch(() => ({}))) as {
          value?: string;
          url?: string;
          error?: string;
        };
        if (!response.ok || !result.value) {
          throw new Error(result.error ?? `Upload failed (${response.status}).`);
        }
        if (!mounted.current) return;
        onChange(result.value);
        setPreviewUrl(result.url ?? null);
      } catch (uploadError) {
        if (mounted.current) {
          setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
        }
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [endpoint, onChange, prefix]
  );

  const showRequiredError = forceValidation && isRequired && !value;

  return (
    <div style={styles.field}>
      <span style={styles.label}>
        {label}
        {isRequired ? ' *' : ''}
      </span>
      {description ? <span style={styles.description}>{description}</span> : null}

      <div
        style={styles.dropzone(dragging, !!showRequiredError)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="" style={styles.thumb} />
        ) : (
          <div style={{ ...styles.thumb, display: 'grid', placeItems: 'center', fontSize: 11 }}>
            {value ? 'no preview' : 'empty'}
          </div>
        )}

        <div style={styles.body}>
          <div style={styles.actions}>
            <button
              type="button"
              style={styles.button}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? 'Uploading…' : value ? 'Replace' : 'Upload image'}
            </button>
            {value ? (
              <button
                type="button"
                style={styles.button}
                disabled={busy}
                onClick={() => {
                  onChange(null);
                  setError(null);
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          <span style={styles.key}>
            {value ? keyOf(value) : 'Drop an image here, or choose a file. Stored in R2.'}
          </span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so re-picking the same file fires change again.
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>

      {error ? <span style={styles.error}>{error}</span> : null}
      {showRequiredError && !error ? (
        <span style={styles.error}>{label} is required.</span>
      ) : null}
    </div>
  );
}
