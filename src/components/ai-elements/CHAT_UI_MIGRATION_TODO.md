## Chat UI Migration TODO (ai-elements Integration)

This checklist tracks replacing the legacy chat UI (components under `features/chat-page` & `features/ui/chat`) with the new composable primitives in `components/ai-elements`.

Legend: 
- [ ] Not started  
- [~] In progress  
- [x] Completed  

### Core Layout & Scrolling
- [x] `Conversation` – Replace `ChatMessageContainer` + `ChatMessageContentArea` + custom scroll anchor logic (`useChatScrollAnchor`). Integrate `StickToBottom` behavior; remove manual ref logic in `chat-page.tsx` (new impl behind flag).
- [x] `ConversationContent` – Wrap mapped messages; apply padding; ensure auto-scroll works with Valtio updates (initial integration done).
- [x] `ConversationScrollButton` – Add floating scroll-to-bottom button; remove legacy auto-scroll toggle if redundant (present in new impl; legacy untouched until full cutover).

### Messages
- [x] `Message` – Replace `ChatMessageArea` wrapper (role-based alignment & spacing) (in new default UI).
- [x] `MessageContent` (component inside `ai-elements/message.tsx`) – Basic bubble styling migrated (actions & copy still pending).
- [x] `MessageAvatar` – Integrated basic avatar (copy button + initials logic OK; advanced profile picture handling minimal).
- [ ] Tool / function messages: render using `Tool` component instead of simple assistant fallback.

### Input Area
- [x] `PromptInput` – Replaces `ChatInputForm` (legacy removed from default path).
- [x] `PromptInputTextarea` – Auto-resize via CSS; dynamic height hook slated for removal after validation.
- [x] `PromptInputToolbar` – Implemented.
- [x] `PromptInputTools` – Basic container with stub buttons (internet/file) + reasoning selector.
- [~] `PromptInputButton` – Using for buttons; needs consolidation of file upload & search toggles with real behavior.
- [x] `PromptInputSubmit` – Uses phase mapping; stop action aborts stream while `streaming`.
- [x] Model selector: integrated using `PromptInputModelSelect*` in toolbar.

### Streaming / Reasoning / Sources
- [~] `Reasoning` – Integrated with timing foundation (reasoningMeta start/elapsed captured) – need to surface elapsed in UI & stream partial tokens separately.
- [~] `ReasoningTrigger` – Elapsed seconds shown; verify auto-close/open with real events.
- [~] `ReasoningContent` – Rendering reasoning markdown via `Response`; need citation adaptation later.
- [ ] `Sources` – Replace the “Used X sources” (if present) or introduce retrieval source summary; map to citation service results.
- [ ] `SourcesTrigger` / `SourcesContent` / `Source` – Implement collapsible list of sources (augment `citation-service.ts` to provide structured array: title, url, snippet).
- [ ] `InlineCitation` system – Replace current `CitationAction` + inline anchor strategy inside `Markdown`; adapt markdown renderer to emit citation spans decorated with `InlineCitation*` components.

### Tool Calls / Functions
- [~] `Tool` – Basic replacement for tool role messages implemented.
- [~] `ToolHeader` – Basic state mapping using `toolCallHistory` + `toolCallInProgress`; refine status transitions & error state.
- [x] `ToolInput` – Arguments parsed and pretty-printed when available.
- [x] `ToolOutput` – Showing result; error state not yet wired.
- [x] Persist enriched tool call history consumption (assistant messages now render embedded tool call list when history exists).

### Branching (Optional / Future)
- [ ] `Branch` / `BranchMessages` – Enable multi-branch response exploration (requires backend returning alternative completions; extend stream parser to collect branches).
- [ ] `BranchSelector` / `BranchPrevious` / `BranchNext` / `BranchPage` – Navigation controls; only render if >1 branch.

### Suggestions & Tasks (Optional Enhancements)
- [ ] `Suggestions` / `Suggestion` – Offer quick prompt chips (seed from conversation context, persona, or extension suggestions; integrate with existing prompt slider defaults).
- [ ] `Task` / `TaskTrigger` / `TaskContent` / `TaskItem` / `TaskItemFile` – Display retrieval / planning / file analysis steps (map to structured events if backend emits them; otherwise derive from tool calls).

### Rich Rendering
- [x] `Response` – Now renders assistant content (basic markdown). Feature parity (citations, code blocks) pending.
- [~] `CodeBlock` / `CodeBlockCopyButton` – Added `RichResponse` parser for fenced code; still need language inference improvements & citation integration.
- [ ] `Image` – Replace `ChatImageDisplay` for both multimodal user inputs and generated outputs (extend if handling multiple images).
- [ ] `web-preview` suite (optional) – Integrate for browsing results (if a web tool extension is active) or previewing fetched pages.

### Loading / Status
- [x] `Loader` – Replaces `ChatLoading` in new UI.
- [ ] Tie `PromptInputSubmit` icon states to chat store: 
  - `submitted` → while initial request posted (before first chunk)  
  - `streaming` → during content events  
  - `error` → on error / abort  
  - default send icon otherwise  

### State & Store Adjustments
- [x] Expose a derived `chatStatus` mapping for `PromptInputSubmit` (implemented `phase`).
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
- [x] Feature flag initial rollout (removed; new UI now default).
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
1. Introduce `Conversation` + `Message` skeleton alongside existing UI (feature flag). (DONE)
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
