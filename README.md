# Nexus

Persistent, user-owned context across AI tools and sessions, by Vybhav Sunil Kumar.

## Product and architecture

Nexus separates durable Markdown knowledge in Obsidian from temporary AI collaborators. A reusable authenticated REST client and local MCP bridge allow tools to search, read and update the same knowledge base. The vault remains portable and useful without any AI provider.

## Included code

- Obsidian REST client and MCP bridge in `adapters/obsidian/`.
- Integration configuration and connection checks in `runtime/`.
- Lifecycle validation and bridge startup scripts in `scripts/`.
- REST and MCP tests in `tests/`.

Use your own vault and local configuration. Obsidian and its REST API plugin are external prerequisites; credentials are never included.

## Portfolio scope

This snapshot includes integration code from the private repository's default branch. Personal notes, health records, daily logs, office context, credential files and original Git history are excluded. It does not include uncommitted development such as the newer Telegram integration.
