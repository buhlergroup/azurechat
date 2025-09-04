## Chat UI Migration TODO (ai-elements Integration)

This checklist tracks replacing the legacy chat UI (components under `features/chat-page` & `features/ui/chat`) with the new composable primitives in `components/ai-elements`.

Legend: 
- [ ] Not started  
- [~] In progress  
- [x] Completed  

### Core Layout & Scrolling
- [ ] `Conversation` – Replace `ChatMessageContainer` + `ChatMessageContentArea` + custom scroll anchor logic (`useChatScrollAnchor`). Integrate `StickToBottom` behavior; remove manual ref logic in `chat-page.tsx`.
- [ ] `ConversationContent` – Wrap mapped messages; apply padding; ensure auto-scroll works with Valtio updates.
- [ ] `ConversationScrollButton` – Add floating scroll-to-bottom button; remove legacy auto-scroll toggle if redundant.

### Messages
- [ ] `Message` – Replace `ChatMessageArea` wrapper (role-based alignment & spacing).
- [ ] `MessageContent` (component inside `ai-elements/message.tsx`) – Use for bubble styling; migrate copy button / tool actions currently handled in `ChatMessageArea` (add via `Actions`).
- [ ] `MessageAvatar` – Replace profile picture + initials logic (use existing `useProfilePicture` hook for `src`).
- [ ] Tool / function messages: render using `Tool` component instead of accordion in `message-content.tsx`.

### Input Area
- [ ] `PromptInput` – Replace `ChatInputForm`.
- [ ] `PromptInputTextarea` – Replace `ChatTextInput` + dynamic height hook (`use-chat-input-dynamic-height`); implement auto-resize using min/max height props (remove manual row management if possible).
- [ ] `PromptInputToolbar` – Houses secondary & primary action areas currently split across `ChatInputActionArea` sections.
- [ ] `PromptInputTools` – Container for AttachFile, PromptSlider, InternetSearch, ReasoningEffortSelector, image input trigger, etc.
- [ ] `PromptInputButton` – Standardize buttons (AttachFile, Prompt slider trigger, microphone (future), stop generation toggle).
- [ ] `PromptInputSubmit` – Replace `SubmitChat` / `StopChat` switching; wire `status` to chat store states: `idle` | `loading` | `file upload` → icon mapping.
- [ ] Model selector: use `PromptInputModelSelect*` components to replace any existing model selection UI (if/when added; currently selector is not in the chat input – integrate near toolbar).

### Streaming / Reasoning / Sources
- [ ] `Reasoning` – Replace custom Accordion reasoning block in `message-content.tsx`; stream partial reasoning tokens (update chat store to expose reasoning state + elapsed seconds if needed).
- [ ] `ReasoningTrigger` – Auto open while streaming; confirm timing matches backend events (`reasoning` events in `chat-store.tsx`).
- [ ] `ReasoningContent` – Feed concatenated reasoning markdown; remove bespoke `Markdown` wrapper for reasoning output.
- [ ] `Sources` – Replace the “Used X sources” (if present) or introduce retrieval source summary; map to citation service results.
- [ ] `SourcesTrigger` / `SourcesContent` / `Source` – Implement collapsible list of sources (augment `citation-service.ts` to provide structured array: title, url, snippet).
- [ ] `InlineCitation` system – Replace current `CitationAction` + inline anchor strategy inside `Markdown`; adapt markdown renderer to emit citation spans decorated with `InlineCitation*` components.

### Tool Calls / Functions
- [ ] `Tool` – Replace Accordion for tool & function role messages in `message-content.tsx`.
- [ ] `ToolHeader` – Show name + status (pending/running/completed/error) using chat store `toolCallHistory` + `toolCallInProgress`.
- [ ] `ToolInput` – Pretty-print JSON arguments (parse stored arguments in history objects).
- [ ] `ToolOutput` – Show result or error; hide when neither.
- [ ] Persist enriched tool call history (already saved in `UpsertChatMessage` when finalContent) – ensure UI consumes from `message.toolCallHistory`.

### Branching (Optional / Future)
- [ ] `Branch` / `BranchMessages` – Enable multi-branch response exploration (requires backend returning alternative completions; extend stream parser to collect branches).
- [ ] `BranchSelector` / `BranchPrevious` / `BranchNext` / `BranchPage` – Navigation controls; only render if >1 branch.

### Suggestions & Tasks (Optional Enhancements)
- [ ] `Suggestions` / `Suggestion` – Offer quick prompt chips (seed from conversation context, persona, or extension suggestions; integrate with existing prompt slider defaults).
- [ ] `Task` / `TaskTrigger` / `TaskContent` / `TaskItem` / `TaskItemFile` – Display retrieval / planning / file analysis steps (map to structured events if backend emits them; otherwise derive from tool calls).

### Rich Rendering
- [ ] `Response` – Replace `Markdown` component for assistant text; evaluate feature parity (citations, code blocks, tables). Integrate custom, if needed, by customizing `streamdown` extension set.
- [ ] `CodeBlock` / `CodeBlockCopyButton` – Replace code block rendering in `Markdown`; ensure language detection is passed from backend or parsed via fenced code blocks.
- [ ] `Image` – Replace `ChatImageDisplay` for both multimodal user inputs and generated outputs (extend if handling multiple images).
- [ ] `web-preview` suite (optional) – Integrate for browsing results (if a web tool extension is active) or previewing fetched pages.

### Loading / Status
- [ ] `Loader` – Replace `ChatLoading` spinner & integrate into streaming placeholder + inside `Tool` running state if desired.
- [ ] Tie `PromptInputSubmit` icon states to chat store: 
  - `submitted` → while initial request posted (before first chunk)  
  - `streaming` → during content events  
  - `error` → on error / abort  
  - default send icon otherwise  

### State & Store Adjustments
- [ ] Expose a derived `chatStatus` mapping for `PromptInputSubmit`.
- [ ] Provide reasoning streaming boolean & elapsed seconds to `Reasoning` (toggle start on first reasoning token, stop on finalContent).
- [ ] Provide tool call statuses (pending/running/completed/error) using existing `toolCallHistory` + `toolCallInProgress`.
- [ ] Normalize message model for sources, citations, tool history arrays.
- [ ] Add support for multi-branch responses (array of assistant variants) – schema change (future).

### Markdown / Rendering Pipeline
- [ ] Audit current `Markdown` component vs `Response` (streamdown) for: tables, lists, inline code, code fences, math, citations, images.
- [ ] Implement adapter to convert legacy citation markers to `InlineCitation` components.
- [ ] Replace direct `Markdown` usage everywhere in chat with `Response` + custom render overrides (if necessary for citations).

### Accessibility & UX
- [ ] Ensure `role="log"` on Conversation and aria-live strategy is preserved or improved.
- [ ] Keyboard navigation: tab order for input toolbar, citation popovers, tool collapsibles.
- [ ] Color contrast parity (compare tokens for dark/light modes).

### Cleanup & Removal
- [ ] Remove obsolete components: `ChatMessageArea`, `ChatMessageContainer`, `ChatMessageContentArea`, `ChatLoading`, `ChatTextInput`, `SubmitChat`, `StopChat`, `chat-input-area/*` wrappers once migrated.
- [ ] Delete dynamic height hook if superseded by CSS auto-resize.
- [ ] Remove Accordion-based reasoning + tool message accordions from `message-content.tsx`.
- [ ] Purge unused styles / utility classes related to old chat UI.

### Testing & Verification
- [ ] Unit: rendering of each new ai-element wrapper with mock data.
- [ ] Integration: streaming simulation (mock SSE) to verify content, reasoning, tool call updates.
- [ ] Visual regression (optional): baseline snapshots before & after migration.
- [ ] Accessibility audit (axe) for new interactive elements.

### Deployment / Rollout
- [ ] Feature flag or branch-based rollout (optional) – `NEXT_PUBLIC_NEW_CHAT_UI=1`.
- [ ] Capture performance metrics (First Contentful Token, scroll performance) pre/post.
- [ ] Update docs (`docs/6-chat-over-file.md`, `docs/reasoning-summaries.md`) referencing new UI.

### Documentation
- [ ] Add usage examples for each ai-element in a Storybook or MDX playground (if tooling available).
- [ ] Architecture note describing migration rationale & component mapping table.

---
### Component Mapping Table (Reference)

| Legacy | New ai-element | Notes |
|--------|----------------|-------|
| ChatMessageContainer / ChatMessageContentArea | Conversation / ConversationContent | Auto-scroll + scroll button |
| ChatMessageArea | Message / MessageContent / MessageAvatar | Role-based alignment |
| ChatLoading | Loader | Spinner |
| message-content (Markdown) | Response (+ InlineCitation, CodeBlock) | Replace markdown pipeline |
| Accordion (Reasoning) | Reasoning* | Auto open/close, duration |
| Accordion (Tool / Function) | Tool* | Collapsible with states |
| ChatInputForm | PromptInput | Form wrapper |
| ChatTextInput | PromptInputTextarea | Enter-to-send behavior included |
| SubmitChat / StopChat | PromptInputSubmit | Icon state machine |
| AttachFile / PromptSlider / ReasoningEffortSelector / InternetSearch | PromptInputTools + PromptInputButton | Consolidated toolbar |
| ChatImageDisplay | Image | Use base64 or URL |
| CitationAction + Markdown anchors | InlineCitation* + Sources* | Structured citations |
| (None) | Suggestions / Branch / Task / WebPreview | New capabilities |

\* denotes streaming / dynamic integration work with chat store.

---
### Initial Execution Order (Suggested)
1. Introduce `Conversation` + `Message` skeleton alongside existing UI (feature flag). 
2. Migrate input to `PromptInput` (keep store logic unchanged). 
3. Replace message rendering with `Response` + code blocks. 
4. Add `Reasoning` streaming integration. 
5. Add `Tool` rendering using toolCallHistory. 
6. Integrate citations (`InlineCitation`, `Sources`). 
7. Clean up legacy components & hooks. 
8. Add optional enhancements (Suggestions, Branch, Task, WebPreview). 
9. Final accessibility & performance pass. 

---
Add progress marks as migration proceeds.
