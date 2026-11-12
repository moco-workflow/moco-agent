import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { looksLikeSiteUrl } from '@/lib/source-kinds';
import { useSitemapCheck } from '@/hooks/use-sitemap-check';
import type { CheckSitemapResult } from '@/types/admin';

/** Long enough that a typed-out URL is one request, not one per keystroke. */
const DEBOUNCE_MS = 700;

type State =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'done'; result: CheckSitemapResult }
  /** The check itself failed. Says nothing about the URL, so it never blocks. */
  | { phase: 'unavailable'; message: string };

/**
 * Live resolution of a `site` source's URL to its sitemap.
 *
 * When the sitemap is found under a URL the user did not type, the field is
 * rewritten to it -- that IS the feature. It settles rather than looping: the
 * rewritten URL already ends in .xml, so the next check has exactly one
 * candidate, which is itself.
 *
 * Advisory only. The authoritative pass is the one SourceForm runs on submit,
 * because this one can be mid-flight, debounced, or looking at a URL the user
 * has since edited.
 */
export function SitemapCheck({
  url,
  onResolve,
  disabled,
}: {
  url: string;
  /** Called with the confirmed sitemap URL when it differs from `url`. */
  onResolve: (sitemapUrl: string) => void;
  disabled?: boolean;
}) {
  const { check } = useSitemapCheck();
  const [state, setState] = useState<State>({ phase: 'idle' });

  // Held in a ref, not a dep: onResolve is a fresh closure on every parent
  // render, and depending on it would restart the debounce on each keystroke
  // of every other field in the form.
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  const trimmed = url.trim();

  useEffect(() => {
    if (disabled || !looksLikeSiteUrl(trimmed)) {
      setState({ phase: 'idle' });
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ phase: 'checking' });
      void (async () => {
        try {
          const result = await check(trimmed, controller.signal);
          if (controller.signal.aborted) return;
          setState({ phase: 'done', result });
          if (result.is_sitemap && result.url !== trimmed) {
            onResolveRef.current(result.url);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          setState({
            phase: 'unavailable',
            message: err instanceof Error ? err.message : 'could not run the check',
          });
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, disabled, check]);

  if (state.phase === 'idle') return null;

  if (state.phase === 'checking') {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Looking for a sitemap…
      </p>
    );
  }

  if (state.phase === 'unavailable') {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Could not check the sitemap ({state.message}). Indexing will still try.</span>
      </p>
    );
  }

  const { result } = state;

  if (result.is_sitemap) {
    const entries = result.entry_count ?? 0;
    return (
      <p className="mt-2 flex items-start gap-1.5 text-xs text-green-400">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Found {entries} {entries === 1 ? 'page' : 'pages'} in{' '}
          <code className="text-green-300">{result.url}</code>
        </span>
      </p>
    );
  }

  return (
    <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        <p>No sitemap found. This source would index nothing.</p>
        <ul className="mt-1 space-y-0.5 text-amber-300/70">
          {result.checked.map((probe) => (
            <li key={probe.url}>
              <code>{probe.url}</code> — {probe.reason || probe.error || 'not a sitemap'}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
