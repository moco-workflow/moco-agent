import { Trash2 } from 'lucide-react';
import { SourceFields } from './source-fields';
import { SitemapCheck } from './sitemap-check';
import { SOURCE_KIND_SPECS, specFor, summarizeSource } from '@/lib/source-kinds';
import type { IndexSource, IndexSourceKind } from '@/types/admin';
import { inputClass } from '@/components/ui/field';

export function SourceEditor({
  sources,
  onChange,
  secretOptions,
  disabled,
}: {
  sources: IndexSource[];
  onChange: (next: IndexSource[]) => void;
  secretOptions: string[];
  disabled?: boolean;
}) {
  const replace = (i: number, next: IndexSource) =>
    onChange(sources.map((s, j) => (j === i ? next : s)));

  const changeKind = (i: number, kind: IndexSourceKind) => {
    // A fresh object rather than a merge: the kinds share almost no fields, and
    // carrying stale ones over would send `url` to a github source.
    replace(i, specFor(kind).make());
  };

  return (
    <div className="space-y-3">
      {sources.map((source, i) => (
        <div key={i} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
          <div className="mb-3 flex items-center gap-2">
            <select
              value={source.kind}
              disabled={disabled}
              onChange={(e) => changeKind(i, e.target.value as IndexSourceKind)}
              className={`${inputClass} w-auto`}
            >
              {SOURCE_KIND_SPECS.map((s) => (
                <option key={s.kind} value={s.kind}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="flex-1 truncate text-xs text-gray-500">
              {summarizeSource(source)}
            </span>
            <button
              type="button"
              disabled={disabled || sources.length === 1}
              onClick={() => onChange(sources.filter((_, j) => j !== i))}
              className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-800 hover:text-red-400 disabled:opacity-30"
              aria-label="Remove source"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="mb-3 text-xs text-gray-600">{specFor(source.kind).blurb}</p>

          <SourceFields
            source={source}
            onChange={(next) => replace(i, next)}
            secretOptions={secretOptions}
            disabled={disabled}
          />

          {/*
            The one kind whose URL is not the URL a human would type: the
            crawler wants the sitemap, not the landing page. Kept here rather
            than in SourceFields so that file stays a loop over the spec table
            instead of growing a per-kind branch.
          */}
          {source.kind === 'site' && (
            <SitemapCheck
              url={source.url}
              onResolve={(sitemapUrl) => replace(i, { ...source, url: sitemapUrl })}
              disabled={disabled}
            />
          )}
        </div>
      ))}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...sources, specFor('web').make()])}
        className="rounded-md border border-dashed border-gray-700 px-3 py-2 text-xs text-gray-400 hover:border-gray-600 hover:text-white disabled:opacity-50"
      >
        + Add another source
      </button>
    </div>
  );
}
