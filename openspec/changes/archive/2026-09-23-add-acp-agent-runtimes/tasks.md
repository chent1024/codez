## 1. Runtime contract and persistence

- [x] 1.1 Define stable Runtime IDs, capability/status contracts, and separate workbench taskId from native ACP sessionId.
- [x] 1.2 Add an additive task-index migration and legacy ZCode ownership fallback; test workspace identity isolation.
- [x] 1.3 Bind Runtime at creation and route existing-session commands, subscriptions, restore and delete by that binding.

## 2. ACP protocol

- [x] 2.1 Add official ACP SDK and a bounded CLI registry/resolver for the four selected agents; implement status/probe without credential persistence.
- [x] 2.2 Implement ACP initialize/new/load/prompt/update/cancel with process lifecycle, capability checks and command idempotency.
- [x] 2.3 Implement host permissions, scoped file/terminal callbacks and MCP negotiation; reject unsupported/untrusted operations.
- [x] 2.4 Translate ACP updates to the existing conversation/index contract with terminal, error, snapshot and replay semantics.
- [x] 2.5 Discover and set per-session thought levels from ACP config options; map exact permission option IDs and settle pending requests on cancel/exit.

## 3. Memory and UI

- [x] 3.1 Follow current ZCode Project Memory identity, index and directory rules; verify ACP file-tool access and explicitly label automatic extraction as unavailable in this phase.
- [x] 3.2 Add ACP providers to the existing model settings and model selector; select execution adapter from providerId without a separate Runtime control.
- [x] 3.3 Show immutable Runtime identity, unavailable/recovery errors and capability-gated actions in desktop and remote UI.
- [x] 3.4 Add Host-side `agent_servers` registry with strict per-entry validation, stable-ID session binding and invalid/missing configuration behavior; keep the four built-in ACP entries during transition.
- [x] 3.5 Let “Add provider” choose API or ACP, and expose configured ACP models through the existing composer model picker without a separate Runtime picker.
- [x] 3.6 Verify a configured alias with a non-builtin Runtime ID through real creation and restart recovery; retain builtins until a separate removal audit.
- [x] 3.7 Persist only user-checked ACP models after manual Agent sync; show only Agent-provided free/discount information and verify no automatic re-fetch on restart or settings open.

## 4. CodeZ identity

- [x] 4.1 Set distinct CodeZ app identity, display name and reverse-Z icon assets for supported desktop platforms.
- [x] 4.2 Move default app data and non-project workspace to `~/.codez`, adjust early bootstrap/CLI storage and test that `~/.zcode` remains untouched.

## 5. Verification and review

- [x] 5.1 Add fake ACP protocol integration tests for lifecycle, duplicates, permissions, crash, restore, memory and cross-workspace isolation.
- [x] 5.2 Run a real configured-alias ACP smoke, desktop restart and replayable-protocol acceptance, relevant package tests, typecheck, lint, architecture check and OpenSpec validation.

The final `rv` follows OpenSpec archive and precedes the separately authorized Git delivery.
