import type { Plugin } from "vite";

/**
 * Makes a failed main or preload build fail `electron-forge package`.
 *
 * Forge's Vite plugin (7.11.2) treats a target as built when Rollup's
 * `closeBundle` hook runs, and as failed only when `buildEnd` receives an
 * error. Under Vite 8, Rolldown reports errors such as `MISSING_EXPORT` while
 * writing the bundle: `buildEnd` sees no error, `closeBundle` still runs, and
 * the later rejection of `vite.build` is lost. Packaging then goes on without
 * `.vite/build/main.js` and fails much later with an unrelated message.
 *
 * This plugin remembers the error from `renderError` and rethrows it from a
 * `closeBundle` handler that runs, alone, before Forge's. Forge's handler is
 * then skipped, so `vite.build` rejects with the original error and Forge
 * fails the target with it. Watch builds (`electron-forge start`) are left
 * alone: there a rebuild error must not stop the watcher.
 */
export function viteBuildGuard(): Plugin {
  let renderFailure: Error | undefined;
  return {
    name: "draft-loop:vite-build-guard",
    apply: (config) => config.build?.watch == null,
    buildStart() {
      renderFailure = undefined;
    },
    renderError(error) {
      renderFailure = error;
    },
    closeBundle: {
      order: "pre",
      sequential: true,
      handler() {
        if (renderFailure !== undefined) {
          throw renderFailure;
        }
      },
    },
  };
}
