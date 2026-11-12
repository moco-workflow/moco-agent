import { useState, useRef, useCallback } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Send } from 'lucide-react';

interface InputBarProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function InputBar({ onSend, disabled }: InputBarProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback((e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-800 p-4">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => { setValue(e.target.value); handleInput(); }}
          onKeyDown={handleKeyDown}
          placeholder="Send a message…"
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="rounded-lg bg-blue-600 p-2.5 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
