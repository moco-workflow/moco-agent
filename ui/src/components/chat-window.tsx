import { MessageList } from './message-list';
import { InputBar } from './input-bar';
import { AppNav } from './app-nav';
import { AgentSwitcher } from './agent-switcher';
import { BrandMark } from './brand-mark';
import { SiteSwitcher } from './site-switcher';
import { UserMenu } from '@/components/user-menu';
import { SessionSidebar } from './session-sidebar';
import { useChat } from '@/hooks/use-chat';
import { useSessions } from '@/hooks/use-sessions';
import { useAgent } from '@/lib/agent-context';
import { MessageSquare } from 'lucide-react';
import { SetupCard } from './setup/setup-card';

/** Per-agent openers. An agent with none gets a plain prompt. */
const SUGGESTED_QUESTIONS: Record<string, string[]> = {
  'moco-assistant': [
    'How do I create a state machine workflow?',
    'What activity types are available?',
    'How do expressions work in moco?',
  ],
};

export function ChatWindow() {
  const { agentId, displayName, readOnly, configError } = useAgent();
  const {
    sessions,
    activeSessionId,
    isLoading: sessionsLoading,
    error: sessionsError,
    selectSession,
    newSession,
    renameSession,
    removeSession,
    refresh,
  } = useSessions();

  // The sidebar owns which conversation is open; this hook only shows and sends
  // into it. Refreshing after each turn is what makes a brand new conversation
  // appear in the list, titled from its first message.
  const { messages, isLoading, isHydrating, sendMessage, respond, rate, progress, retry } = useChat({
    sessionId: activeSessionId,
    onTurnComplete: refresh,
  });

  const isEmpty = messages.length === 0 && !isLoading && !isHydrating;
  const suggestions = SUGGESTED_QUESTIONS[agentId] ?? [];

  return (
    <div className="flex h-screen bg-gray-950">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isLoading={sessionsLoading}
        error={sessionsError}
        readOnly={readOnly}
        onSelect={selectSession}
        onNew={newSession}
        onRename={renameSession}
        onDelete={removeSession}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden">
            <div className="flex shrink-0 items-center gap-2">
              <BrandMark className="h-5 w-5" />
              <h1 className="text-sm font-semibold text-white">Moco Agent</h1>
            </div>
            <span aria-hidden className="h-4 w-px shrink-0 bg-gray-800" />
            <AppNav current="chat" />
            <span aria-hidden className="h-4 w-px shrink-0 bg-gray-800" />
            <AgentSwitcher />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <SiteSwitcher current="agent" />
            <UserMenu />
          </div>
        </header>

        {configError && (
          <div className="border-b border-red-900/60 bg-red-950/30 px-4 py-2 text-xs text-red-300">
            Could not load agent “{agentId}”: {configError}
          </div>
        )}

        {isEmpty ? (
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="max-w-md text-center">
              <MessageSquare className="mx-auto mb-4 h-12 w-12 text-gray-700" />
              <h2 className="mb-2 text-lg font-medium text-gray-300">Ask {displayName}</h2>
              <p className="mb-6 text-sm text-gray-500">
                Conversations are kept per agent; switch agents from the header.
              </p>
              {/* First run (F70): what to set up, before a question meets an apology. */}
              <div className="mb-6">
                <SetupCard compact />
              </div>
              <div className="flex flex-col gap-2">
                {suggestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-2.5 text-left text-sm text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            progress={progress}
            onRespond={readOnly === false ? respond : undefined}
            onRate={readOnly === false ? rate : undefined}
            onRetry={retry}
          />
        )}

        <InputBar onSend={sendMessage} disabled={isLoading || isHydrating} />
      </div>
    </div>
  );
}
