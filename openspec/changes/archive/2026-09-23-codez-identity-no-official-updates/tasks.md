## 1. CodeZ identity and update isolation

- [x] 1.1 Default the standard desktop bundle to production CodeZ while preserving explicit test/Preview builds.
- [x] 1.2 Switch desktop URL registration and generated callback/share/folder links to `codez://`.
- [x] 1.3 Disable the official application updater and remote force-update gate; remove visible update controls.
- [x] 1.4 Verify installed bundle identity, protocol, first-launch copy, and disabled application updater.

## 2. Built-in plugins

- [x] 2.1 Stage all declared built-in plugin resources from a local installed source without adding those assets to Git.
- [x] 2.2 Fail packaging on missing manifest/required seed paths and verify the installed plugin list.
