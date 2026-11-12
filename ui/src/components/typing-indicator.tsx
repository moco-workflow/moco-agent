import { describeProgress, type TurnProgress } from '@/lib/progress-stream';

interface TypingIndicatorProps {
  /** The turn's latest stage; null shows the plain "Thinking...". */
  progress?: TurnProgress | null;
}

export function TypingIndicator({ progress = null }: TypingIndicatorProps) {
  return (
    <div className="flex items-center gap-1 px-4 py-3" aria-live="polite">
      <div className="flex gap-1">
        <span className="h-2 w-2 rounded-full bg-gray-500 animate-bounce [animation-delay:0ms]" />
        <span className="h-2 w-2 rounded-full bg-gray-500 animate-bounce [animation-delay:150ms]" />
        <span className="h-2 w-2 rounded-full bg-gray-500 animate-bounce [animation-delay:300ms]" />
      </div>
      <span className="ml-2 text-xs text-gray-500">{describeProgress(progress)}</span>
    </div>
  );
}
