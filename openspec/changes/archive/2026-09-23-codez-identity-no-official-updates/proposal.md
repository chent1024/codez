## Why

CodeZ already has a separate application ID and data root, but its default desktop bundle can become a test Preview build, its deep links still claim `zcode://`, and the installed production build can contact the official ZCode app update feed. The current CodeZ bundle also seeds only two of the official plugin definitions, leaving the other built-in capabilities absent from the plugin list.

## What Changes

- Default the local desktop bundling entry to a production CodeZ build; keep explicit test/Preview builds available.
- **BREAKING**: use `codez://` for CodeZ desktop deep links and generated links, without registering the official app's `zcode://` scheme.
- Remove the desktop app's automatic/manual online update paths and remote minimum-version startup gate, including their visible controls. Plugin marketplace refresh remains available.
- Bundle and seed the official plugin definitions supported by this repository so the CodeZ installed app can list and use them without reading ZCode's user data or installation at runtime.
- Align the main CodeZ welcome and app-install copy with the product identity.

## Capabilities

### New Capabilities

- `codez-official-plugins`: built-in plugin availability and verification in CodeZ packages.

### Modified Capabilities

- `codez-app-identity`: CodeZ packaging defaults, separate URL protocol, and standalone update behavior.

## Impact

Desktop packaging, macOS/Windows/Linux protocol registration, OAuth/share/Finder link generation, startup update integration, desktop update UI, bundled CLI plugin assets, and the CodeZ identity spec. Existing `zcode://` links continue to target the official ZCode installation; new CodeZ links use `codez://`.
