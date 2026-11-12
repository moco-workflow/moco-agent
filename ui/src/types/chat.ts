import type { AnswerSource, TurnSetup } from './admin';

/**
 * What a turn is waiting on (hitl). `tool_call`: approve / approve_session (only with
 * offer_session_grant) / reject; `user_input`: the agent asked a question -- the reply is
 * typed in the input box.
 */
export interface PendingAction {
  id?: string;
  kind?: 'tool_call' | 'user_input' | string;
  summary?: string;
  offer_session_grant?: boolean;
}

/** A UI reply to a pending action, sent through agent-cli's `action` input. */
export type PendingDecision = 'approve' | 'approve_session' | 'reject';

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  sources?: AnswerSource[];
  timestamp: number;
  error?: string;
  /** The turn number session-store stamped this exchange with. */
  turn?: number;
  /** Which profile answered (chat, rag, ...). */
  route?: string | null;
  /** ok | declined | error, from the profile contract. */
  status?: string;
  /**
   * The agent-cli run that asked, for the trace link. Live turns get it from the
   * response, restored ones from the transcript (absent on turns stored before
   * harness 0.3.3).
   */
  workflowId?: string;
  /** The action this answer waits on; set on the live answer, inferred on a restored one. */
  pendingAction?: PendingAction | null;
  /** The rating given in this browser session (the server keeps it per turn). */
  feedback?: 'up' | 'down';
  /** Set when the turn failed because a model is not set up (F70). */
  setup?: TurnSetup | null;
}

/** agent-harness/agent-cli's output. */
export interface AgentCliResult {
  answer: string;
  sources: AnswerSource[];
  session_id: string;
  message_id: string;
  turn: number | null;
  workflow_id?: string;
  status: string;
  route?: string | null;
  pending_action?: PendingAction | null;
  /** {role, reason, secret_name, scope} when a model is not set up (F70). */
  setup?: TurnSetup | null;
}
