import { config } from './config';

/** Matches agent-cli's 120s wait_for, with a little headroom. */
export const CHAT_TIMEOUT_MS = 130_000;

const EXECUTE_MODES = ['in-memory', 'standalone-activity', 'workflow'] as const;
export type ExecuteMode = (typeof EXECUTE_MODES)[number];

export interface ExecuteOptions {
  /** Defaults to CHAT_TIMEOUT_MS. Admin calls should pass something much lower. */
  timeoutMs?: number;
  /** Defaults to VITE_EXECUTE_MODE, else the server's choice. */
  executeMode?: ExecuteMode;
  /** Defaults to VITE_ENABLE_OTEL_TRACE, else the server's choice (off). */
  enableOtelTrace?: boolean;
  /** Caller cancellation, e.g. an effect cleanup on unmount. */
  signal?: AbortSignal;
  /** Run under this trace id (with debugMode, its debug events stream to /events/{traceId}). */
  traceId?: string;
  /** Publish the run's debug events (`#` variables) -- what the progress stream reads. */
  debugMode?: boolean;
}

/**
 * Chat turns always run as a real workflow and are always traced, whatever the
 * build defaults say, so one can be followed end-to-end across the server,
 * worker and activity spans in the OTel backend.
 */
export const CHAT_EXECUTE_OPTIONS = {
  executeMode: 'workflow',
  enableOtelTrace: true,
} as const satisfies ExecuteOptions;

/**
 * Build-wide default execute options, from VITE_EXECUTE_MODE and
 * VITE_ENABLE_OTEL_TRACE -- mirrors moco-ui/src/lib/api/workflows.ts.
 *
 * Only set keys are sent: an absent key leaves the choice to the server
 * (`workflow` mode, tracing off). An unrecognised value is a configuration bug
 * -- say so rather than let the server reject every call.
 */
const getDefaultExecuteOptions = (): Record<string, unknown> => {
  const defaults: Record<string, unknown> = {};

  const mode = import.meta.env.VITE_EXECUTE_MODE;
  if (mode && (EXECUTE_MODES as readonly string[]).includes(mode)) {
    defaults.execute_mode = mode;
  } else if (mode) {
    console.error(
      `[Workflow] VITE_EXECUTE_MODE="${mode}" is not recognised ` +
        `(expected one of ${EXECUTE_MODES.join(', ')}); leaving it to the server.`
    );
  }

  const trace = import.meta.env.VITE_ENABLE_OTEL_TRACE;
  if (trace === 'true' || trace === 'false') {
    defaults.enable_otel_trace = trace === 'true';
  } else if (trace) {
    console.error(
      `[Workflow] VITE_ENABLE_OTEL_TRACE="${trace}" is not recognised ` +
        '(expected "true" or "false"); leaving it to the server.'
    );
  }

  return defaults;
};

const DEFAULT_EXECUTE_OPTIONS = getDefaultExecuteOptions();

export async function executeWorkflow(
  name: string,
  inputData: Record<string, unknown>,
  token?: string | null,
  options?: ExecuteOptions
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // A chat turn genuinely needs ~130s, but settings and polls do not: at that
  // ceiling a hung save freezes the form for over two minutes, and a 5s poll
  // against a stalled backend piles up ~26 in-flight requests.
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? CHAT_TIMEOUT_MS
  );
  const onExternalAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetch(`${config.apiBaseUrl}/api/workflow/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        wfspec_info: { name },
        input_data: inputData,
        // Build defaults first; anything the caller pins (CHAT_EXECUTE_OPTIONS)
        // wins.
        options: {
          ...DEFAULT_EXECUTE_OPTIONS,
          ...(options?.executeMode !== undefined && { execute_mode: options.executeMode }),
          ...(options?.enableOtelTrace !== undefined && {
            enable_otel_trace: options.enableOtelTrace,
          }),
          ...(options?.traceId && { trace_id: options.traceId }),
          ...(options?.debugMode !== undefined && { debug_mode: options.debugMode }),
        },
      }),
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${text}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', onExternalAbort);
  }
}
