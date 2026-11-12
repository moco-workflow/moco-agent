import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A message's time: just the time today, else the date too (the year only if not this one). */
export function formatMessageTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], time);
  return date.toLocaleString([], {
    ...time,
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}
