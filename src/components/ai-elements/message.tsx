import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/features/ui/avatar';
import { cn } from '@/features/ui/lib';
import type { UIMessage } from 'ai';
import type { ComponentProps, HTMLAttributes } from 'react';

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage['role'];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
  'group flex w-full min-w-0 items-end justify-end gap-2 py-4',
  from === 'user' ? 'is-user' : 'is-assistant flex-row-reverse justify-end',
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
  'flex flex-col gap-2 overflow-hidden min-w-0 text-foreground text-sm',
  'group-[.is-user]:w-fit group-[.is-user]:max-w-[75%] group-[.is-user]:break-words group-[.is-user]:whitespace-pre-wrap group-[.is-user]:ml-auto',
  'group-[.is-user]:rounded-xl group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:bg-background group-[.is-user]:text-foreground group-[.is-user]:border-2 group-[.is-user]:border-primary',
  'group-[.is-assistant]:px-0 group-[.is-assistant]:py-0',
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageAvatarProps = ComponentProps<typeof Avatar> & {
  src: string;
  name?: string;
};

export const MessageAvatar = ({
  src,
  name,
  className,
  ...props
}: MessageAvatarProps) => (
  <Avatar className={cn('size-8 ring-1 ring-border', className)} {...props}>
    <AvatarImage alt="" className="mt-0 mb-0" src={src} />
    <AvatarFallback>{name?.slice(0, 2) || 'ME'}</AvatarFallback>
  </Avatar>
);
