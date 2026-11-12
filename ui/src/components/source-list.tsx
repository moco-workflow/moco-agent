import type { AnswerSource } from '@/types/admin';

interface SourceListProps {
  sources: AnswerSource[];
}

/** The passages the answer cites as [n], in citation order. */
export function SourceList({ sources }: SourceListProps) {
  if (sources.length === 0) return null;

  return (
    <details className="mt-2 group">
      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400 select-none">
        {sources.length} source{sources.length !== 1 ? 's' : ''}
      </summary>
      <ul className="mt-1 space-y-0.5 text-xs text-gray-400">
        {sources.map((source, i) => {
          const label = source.title || source.url || source.source || 'untitled';
          return (
            <li key={`${source.n ?? i}-${i}`} className="pl-3 border-l border-gray-700">
              {source.n !== undefined && <span className="mr-1 text-gray-500">[{source.n}]</span>}
              {/* Only http(s): a source URL comes from indexed content, and a
                  javascript: one must not become a live link. */}
              {source.url && /^https?:\/\//i.test(source.url) ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-gray-600 hover:text-gray-200"
                >
                  {label}
                </a>
              ) : (
                label
              )}
              {source.source && <span className="ml-1 text-gray-600">· {source.source}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
