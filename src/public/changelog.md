# Release Notes

## [Unreleased]

### Agent Publishing & Statistics
- **Added:** You can now publish your agents to the whole organization — find the switch in the agent's "Access to Agent" section.
- **Added:** Trust levels for published agents: **Verified** (reviewed by the agent governance team) and **Community** (published by a colleague), shown as badges on agent cards. Governance-team members can verify, downgrade, or unpublish agents.
- **Added:** Usage statistics per agent — chats, messages, and tokens — shown on agent cards.
- **Added:** Sort agents by most used (default), recently updated, newest, or name, plus a trust-level filter on the Agents page.
- **Changed:** The home page now shows only your favorite agents; discover and manage all agents on the Agents page ("Browse all agents").
- **Fixed:** Editing an agent no longer bumps it to the top of the "Newest" sort order.

### Logging Improvements
- **Enhanced:** Replaced console.log statements with centralized logging utility across the entire codebase
- **Added:** Structured logging with context support for better debugging
- **Added:** Azure Application Insights integration for production monitoring
- **Added:** Environment-aware logging with cost optimization (errors only in production by default)
- **Added:** Configurable log levels via `LOG_LEVEL` or `NEXT_PUBLIC_LOG_LEVEL` environment variables
- **Improved:** Model selector error handling with proper logging instead of console.error
- **Improved:** API route error handling with structured logging for better observability

## [v2.3.0] – 2025-04-11

- Added: Add SharePoint Files to Persona
- Added: Configure Persona Access via SharePoint Groups

## [v2.2.0] – 2025-03-21

- Added: Duplicate and customise personas.

## [v2.1.0] – 2025-03-19

- Added: Feedback Form
- Added: Document uploads now support text files (.txt, .md, etc.).
- Changed: Internet Search functionality moved to the chatbox.
- Added: Files can now be deleted from a chat.
- Added: Files are now visible in the chatbox.
- Fixed: Tool editing icons are now shown based on user permissions.
- Fixed: Improved feedback when attempting to upload files that exceed size limits.
- Added: Introduced a changelog to track updates.

## [v2.0.0] – 2024-06-13

- Added: Re-worked UI with a modern Bühler-themed design, including a clean layout and Bühler colors.
- Added: Sidebar now displays past chats and allows bookmarking important chats.
- Added: Main start page contains a news and best practices article section for Bühler Chat and a lower section showcasing personas.
- Added: Support for Personas, which are user-guided AI assistants tailored via specific prompts.
- Added: Ability to share personas via a link.
- Added: Integration of DALL·E 3 for image creation based on text descriptions, with automatic handling of prompts for generating images.
