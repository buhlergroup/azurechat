"use client";
import React from 'react';
import { Response } from './response';
import { CodeBlock, CodeBlockCopyButton } from './code-block';

export interface RichResponseProps {
  content: string;
}

type Segment = { type: 'code'; language: string; code: string } | { type: 'text'; text: string };

function parse(content: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /```([a-zA-Z0-9_-]*)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const language = (match[1] || 'text').toLowerCase();
    if (['mermaid', 'plantuml', 'dot', 'graphviz'].includes(language)) {
      continue;
    }

    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      language: match[1] || 'text',
      code: match[2].replace(/\n$/,'')
    });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) });
  }
  return segments;
}

export const RichResponse: React.FC<RichResponseProps> = ({ content }) => {
  const segments = React.useMemo(() => parse(content), [content]);
  // If no code segments, render whole content once to preserve full markdown context
  const hasCode = segments.some(s => s.type === 'code');
  if (!hasCode) {
    return <Response>{content}</Response>;
  }

  return (
    <div className="flex flex-col gap-4">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return (
            <CodeBlock key={i} code={seg.code} language={seg.language}>
              <CodeBlockCopyButton />
            </CodeBlock>
          );
        }
        // Preserve original spacing; don't trim to keep markdown structure (headings, lists, tables)
        if (seg.text.length === 0) return null;
        return <Response key={i}>{seg.text}</Response>;
      })}
    </div>
  );
};
