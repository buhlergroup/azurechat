'use client';

import { cn } from '@/features/ui/lib';
import { type ComponentProps, memo } from 'react';
import { Streamdown } from 'streamdown';

type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
  'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  // Add list + typography styling (avoid max-width clamp)
  'prose prose-neutral dark:prose-invert max-w-none',
  // Ensure ul/ol bullets & spacing even if global reset removed them
  '[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6',
  // Tighten paragraph spacing inside list items
  '[&_li>p]:m-0',
        className
      )}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

Response.displayName = 'Response';
