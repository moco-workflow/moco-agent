import { config } from './config';

/**
 * One stage of a turn, as agent-cli logs it (`progress#`, design §11.4). `stage` is
 * received | routed | running | searching | thinking | calling | answered; the other
 * keys depend on the stage.
 */
export interface TurnProgress {
  stage: string;
  route?: string;
  sources?: string[];
  profile?: string;
  tool?: string;
  step?: number;
  turn?: number;
}

/** How long to wait for the stream's `ready` frame before sending the turn anyway. */
const READY_TIMEOUT_MS = 2_000;

/** A 32-hex trace id: OTel-compatible, and 128 bits so it doubles as the stream's capability. */
export function mintTraceId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export interface ProgressStream {
  /** Resolves once the server is subscribed (or after READY_TIMEOUT_MS, or on failure). */
  ready: Promise<void>;
  /** Stop reading; safe to call more than once. */
  close: () => void;
}

/**
 * Follow a run's debug events (`GET /api/workflow/events/{trace_id}`) and report every
 * `progress` value. Open it BEFORE posting the turn with the same trace_id and
 * debug_mode, or the first stages are missed.
 *
 * fetch, not EventSource: EventSource cannot send the Authorization header. Best effort
 * throughout -- no RabbitMQ, an old server or a dropped connection only means no
 * progress; the turn itself is unaffected, so nothing here throws.
 */
export function openProgressStream(
  traceId: string,
  token: string | null | undefined,
  onProgress: (progress: TurnProgress) => void
): ProgressStream {
  const controller = new AbortController();
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
    setTimeout(resolve, READY_TIMEOUT_MS);
  });

  const handleFrame = (event: string, data: string) => {
    if (event === 'ready') {
      markReady();
      return;
    }
    if (event !== 'debug') return;
    try {
      const parsed = JSON.parse(data) as {
        event_type?: string;
        event_data?: { var_name?: string; value?: unknown };
      };
      if (parsed.event_type !== 'data_log' || parsed.event_data?.var_name !== 'progress') return;
      const value = parsed.event_data.value;
      if (value && typeof value === 'object' && typeof (value as TurnProgress).stage === 'string') {
        onProgress(value as TurnProgress);
      }
    } catch {
      // A frame we cannot read is skipped, not fatal.
    }
  };

  void (async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/workflow/events/${traceId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        // Frames end with a blank line; a frame's `data:` is a single line (the server
        // escapes newlines), and `:` lines are keepalives.
        let end = buffer.indexOf('\n\n');
        while (end !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let event = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) handleFrame(event, data);
          end = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Aborted or dropped: progress is best effort.
    } finally {
      markReady();
    }
  })();

  return { ready, close: () => controller.abort() };
}

/** What the typing indicator says for a stage. */
export function describeProgress(progress: TurnProgress | null): string {
  if (!progress) return 'Thinking...';
  const sources = progress.sources?.length ? progress.sources.join(', ') : '';
  switch (progress.stage) {
    case 'received':
      return 'Reading your message...';
    case 'routed':
      return progress.route ? `Answering with ${progress.route}...` : 'Choosing how to answer...';
    case 'running':
      return progress.profile ? `Running ${progress.profile}...` : 'Working...';
    case 'searching':
      return sources ? `Searching ${sources}...` : 'Searching...';
    case 'thinking':
      return 'Writing the answer...';
    case 'calling':
      return progress.tool ? `Using ${progress.tool}...` : 'Using a tool...';
    case 'answered':
      return 'Finishing...';
    default:
      return 'Thinking...';
  }
}
