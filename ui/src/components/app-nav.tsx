import { Link } from 'react-router-dom';
import { Activity, Brain, Library, MessageSquare, Settings, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NavTarget = 'chat' | 'knowledge' | 'memory' | 'tools' | 'activity' | 'settings';

const LINKS: { to: string; id: NavTarget; label: string; Icon: typeof MessageSquare }[] = [
  { to: '/', id: 'chat', label: 'Chat', Icon: MessageSquare },
  { to: '/knowledge', id: 'knowledge', label: 'Knowledge', Icon: Library },
  { to: '/memory', id: 'memory', label: 'Memory', Icon: Brain },
  { to: '/tools', id: 'tools', label: 'Tools', Icon: Wrench },
  { to: '/activity', id: 'activity', label: 'Activity', Icon: Activity },
  { to: '/settings', id: 'settings', label: 'Settings', Icon: Settings },
];

export function AppNav({ current }: { current: NavTarget }) {
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map(({ to, id, label, Icon }) => (
        <Link
          key={id}
          to={to}
          aria-current={id === current ? "page" : undefined}
          title={label}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
            id === current
              ? 'bg-gray-800 text-white'
              : 'text-gray-400 hover:bg-gray-800 hover:text-white'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="hidden 2xl:inline">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
