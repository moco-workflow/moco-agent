import { useEffect, useRef } from 'react';
import { MessageBubble } from './message-bubble';
import { TypingIndicator } from './typing-indicator';
import type { ChatMessage, PendingDecision } from '@/types/chat';
import type { TurnProgress } from '@/lib/progress-stream';

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  /** The turn in flight's latest stage, for the typing indicator. */
  progress?: TurnProgress | null;
  onRespond?: (decision: PendingDecision) => Promise<void>;
  onRate?: (messageId: string, rating: 'up' | 'down') => Promise<void>;
  /** Ask a setup-failed question again (F70). */
  onRetry?: (messageId: string) => Promise<void>;
}

export function MessageList({ messages, isLoading, progress = null, onRespond, onRate, onRetry }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return null;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
      {messages.map((msg, i) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          onRespond={i === messages.length - 1 && !isLoading ? onRespond : undefined}
          onRate={onRate ? (rating) => onRate(msg.id, rating) : undefined}
          onRetry={onRetry && !isLoading ? () => onRetry(msg.id) : undefined}
        />
      ))}
      {isLoading && <TypingIndicator progress={progress} />}
      <div ref={endRef} />
    </div>
  );
}
