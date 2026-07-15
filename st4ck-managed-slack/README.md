# st4ck for Managed Slack

This package gives a managed Claude Tag in a shared Slack project channel one project-bound st4ck MCP connector plus operating guidance for safe channel collaboration.

The package contains no credential, header, environment-variable placeholder, or user-config secret. The Claude Tag Access bundle supplies the project-bound Bearer credential when it connects to `https://app.st4ck.io/mcp/managed-connector/`.

## Contents

- `.mcp.json` — the single managed st4ck connector
- `skills/shared-channel-st4ck/SKILL.md` — shared-channel operating rules

Install only through the managed Claude Tag Access bundle associated with the intended Slack channel and st4ck project. Reuse this package across channels, but give every project channel its own project-bound credential and Access bundle.
