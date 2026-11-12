import type { IndexSource, IndexSourceKind } from '@/types/admin';

/**
 * One table describing every source kind, so the "add source" factory and the
 * field renderer stay in sync and source-fields.tsx is a loop rather than a
 * five-way switch.
 *
 * `name` values MUST match the `iter_item.get(...)` lookups in
 * knowledge-index-run.yaml exactly. A rename here compiles fine and then
 * silently indexes nothing.
 */

export type FieldType = 'text' | 'number' | 'boolean' | 'stringList' | 'secret' | 'select';

export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
}

export interface SourceKindSpec {
  kind: IndexSourceKind;
  label: string;
  blurb: string;
  fields: FieldSpec[];
  make: () => IndexSource;
}

export const SOURCE_KIND_SPECS: SourceKindSpec[] = [
  {
    kind: 'web',
    label: 'Web pages',
    blurb: 'A fixed list of URLs.',
    fields: [
      {
        name: 'urls',
        label: 'URLs',
        type: 'stringList',
        required: true,
        placeholder: 'https://example.com/page',
      },
      {
        name: 'loader',
        label: 'Loader',
        type: 'select',
        options: [
          { value: 'trafilatura', label: 'trafilatura — extract article text (HTML)' },
          { value: 'download', label: 'download — raw file (PDF, DOCX, CSV)' },
        ],
        hint:
          'Use trafilatura for HTML. The download loader keeps raw markup, so navigation, ' +
          'CSS class names and inline SVG paths get embedded as if they were prose — on three ' +
          'moco doc pages it produced 148 chunks where trafilatura produced 15. Use download ' +
          'for PDF/DOCX/CSV, where it is the only loader that parses by extension.',
      },
    ],
    make: () => ({ kind: 'web', urls: [''], loader: 'trafilatura' }),
  },
  {
    kind: 'site',
    label: 'Whole site',
    blurb: 'Crawl a site from its sitemap.',
    fields: [
      {
        name: 'url',
        label: 'Site URL',
        type: 'text',
        required: true,
        placeholder: 'http://localhost:8080/docs',
        hint:
          'The crawler reads sitemap.xml, so that is what gets indexed. Enter the site ' +
          'address and sitemap.xml is appended and checked for you; enter a sitemap URL ' +
          'directly and it is used as given.',
      },
      { name: 'prefix', label: 'Path prefix', type: 'text', hint: 'Optional. Only crawl URLs starting with this.' },
      { name: 'max_depth', label: 'Max depth', type: 'number' },
      { name: 'limit', label: 'Page limit', type: 'number', hint: 'A large crawl can take many minutes.' },
    ],
    make: () => ({ kind: 'site', url: '', prefix: null, max_depth: 3, limit: 50 }),
  },
  {
    kind: 'github',
    label: 'GitHub repo',
    blurb: 'Files from a branch of a repository.',
    fields: [
      { name: 'owner', label: 'Owner', type: 'text', required: true, placeholder: 'acme' },
      { name: 'repo', label: 'Repository', type: 'text', required: true, placeholder: 'handbook' },
      { name: 'branch', label: 'Branch', type: 'text', placeholder: 'main' },
      {
        name: 'token_secret_key',
        label: 'Token secret',
        type: 'secret',
        hint: 'Required for private repos. The NAME of an uploaded secret, not the token itself.',
      },
      { name: 'api_base_url', label: 'API base URL', type: 'text', hint: 'For GitHub Enterprise.' },
      { name: 'include_directories', label: 'Directories', type: 'stringList', placeholder: 'docs' },
      { name: 'include_extensions', label: 'Extensions', type: 'stringList', placeholder: '.md' },
    ],
    make: () => ({
      kind: 'github',
      owner: '',
      repo: '',
      branch: 'main',
      token_secret_key: null,
      include_directories: [],
      include_extensions: ['.md'],
    }),
  },
  {
    kind: 'files',
    label: 'Local files',
    blurb: 'Files already on the worker.',
    fields: [
      {
        name: 'path',
        label: 'Path',
        type: 'text',
        required: true,
        placeholder: 'notes',
        hint: 'Relative to the worker’s MOCO_RAG_FILE_DIR. Paths escaping that root are rejected.',
      },
      { name: 'recursive', label: 'Include subdirectories', type: 'boolean' },
      { name: 'required_extensions', label: 'Extensions', type: 'stringList', placeholder: '.md' },
    ],
    make: () => ({ kind: 'files', path: '', recursive: true, required_extensions: ['.md'] }),
  },
  {
    kind: 'gdrive',
    label: 'Google Drive',
    blurb: 'A Drive folder or specific files.',
    fields: [
      {
        name: 'credentials_secret_key',
        label: 'Credentials secret',
        type: 'secret',
        required: true,
        hint: 'The NAME of an uploaded service-account credentials secret.',
      },
      { name: 'folder_id', label: 'Folder ID', type: 'text' },
      { name: 'file_ids', label: 'File IDs', type: 'stringList' },
      { name: 'drive_id', label: 'Shared drive ID', type: 'text' },
    ],
    make: () => ({ kind: 'gdrive', credentials_secret_key: '', folder_id: null, file_ids: [] }),
  },
];

/**
 * Whether a `site` URL is complete enough to be worth a round trip. Deliberately
 * loose -- agent-admin does the real parsing, and the only job here is to not
 * probe "htt" while someone is still typing.
 */
export function looksLikeSiteUrl(url: string): boolean {
  return /^https?:\/\/[^/?#\s]+/i.test(url.trim());
}

export function specFor(kind: IndexSourceKind): SourceKindSpec {
  const spec = SOURCE_KIND_SPECS.find((s) => s.kind === kind);
  if (!spec) throw new Error(`Unknown source kind: ${kind}`);
  return spec;
}

/** A one-line description of a configured source, for the collapsed row. */
export function summarizeSource(source: IndexSource): string {
  switch (source.kind) {
    case 'web':
      return source.urls.filter(Boolean).join(', ') || 'no URLs yet';
    case 'site':
      return source.url || 'no URL yet';
    case 'github':
      return source.owner && source.repo
        ? `${source.owner}/${source.repo}${source.branch ? `@${source.branch}` : ''}`
        : 'no repository yet';
    case 'files':
      return source.path || 'no path yet';
    case 'gdrive':
      return source.folder_id || source.file_ids?.join(', ') || 'no folder or files yet';
  }
}

/**
 * Strip empty optional fields before sending. The backend dispatches on `kind`
 * and reads only that kind's fields, but sending `prefix: ""` where it expects
 * null or absent changes crawl behaviour.
 */
export function cleanSource(source: IndexSource): IndexSource {
  const out: Record<string, unknown> = { kind: source.kind };
  for (const [k, v] of Object.entries(source)) {
    if (k === 'kind') continue;
    if (v === '' || v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const kept = v.filter((item) => String(item).trim() !== '');
      if (kept.length === 0) continue;
      out[k] = kept;
      continue;
    }
    out[k] = v;
  }
  // The narrowing is genuine but not provable to the compiler: `out` is rebuilt
  // key-by-key from an already-valid IndexSource, minus the empty optionals.
  return out as unknown as IndexSource;
}
