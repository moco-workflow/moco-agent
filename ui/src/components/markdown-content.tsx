import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

const components: Components = {
  // Agent answers often cite external docs — never navigate away from the chat.
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Wide tables scroll inside the bubble instead of stretching it.
  table: ({ node, ...props }) => (
    <div className="my-4 overflow-x-auto">
      <table {...props} />
    </div>
  ),
};

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div
      className={cn(
        'markdown-body prose prose-sm prose-invert max-w-none',
        'prose-a:text-blue-400 hover:prose-a:text-blue-300',
        'prose-headings:text-gray-100 prose-strong:text-gray-100',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
