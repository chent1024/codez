## Context

CodeZ has its own bundle ID and data root, but the desktop packaging entry defaults to Preview when `ZCODE_ENV` is unset. Desktop protocol registration and generated links still use `zcode://`. The production main process initializes the official updater and remote minimum-version gate. The CLI advertises more built-in plugins than the desktop bundle stages.

## Goals / Non-Goals

- Make a standard desktop bundle identify itself as CodeZ on this host and register only `codez://`.
- Prevent CodeZ from checking, downloading, or installing official application updates, and remove the corresponding controls.
- Make the packaged built-in plugin list correspond to its available assets; keep application updates separate from plugin marketplace refresh.
- Do not migrate or read ZCode's user settings or plugin state.

## Decisions

- Default only the `bundle:desktop` entry to production when no environment is supplied. Explicit Preview/test builds retain their existing semantics.
- Switch the desktop URL protocol, OAuth callback, share import, and folder-open integrations together. CodeZ will not claim the official `zcode://` scheme.
- Disable the updater and force-update gate at the main-process entry and remove user-facing update controls. Existing persisted preference fields may remain inert for compatibility with saved settings.
- Stage missing built-in plugin assets from the already installed ZCode app at build time, or from an explicit `CODEZ_OFFICIAL_PLUGIN_SOURCE` directory. No imported plugin bytes are committed to Git, and the resulting CodeZ app runs from its own bundle after installation. Validate manifests and required seed paths before a package is emitted.

## Risks / Tradeoffs

- Existing CodeZ links with `zcode://` will continue to open ZCode. New links use `codez://`.
- OAuth providers must accept the new callback URI; an external provider rejection cannot be verified from repository code alone.
- Source availability and redistribution rights differ among built-in plugins. A package build requires a locally available source and must fail clearly rather than silently omit plugins; sharing a package built with restricted assets requires separate rights review.

## Migration Plan

- Build and inspect the fresh package's bundle ID, protocol, bundled plugin roots, and update UI.
- Install CodeZ without touching ZCode or `.zcode` data. Read back the installed identity and plugin list.
- Store the requested ACP agents in `.codez` after installation and verify registry readback.
