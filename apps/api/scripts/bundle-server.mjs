// Bundles the api server and the workspace packages it imports into one ES module,
// `dist/server.mjs`, so the image starts plain JavaScript instead of compiling TypeScript with tsx
// on every cold start. Third-party packages stay external and load from the installed
// `node_modules`, as they do under tsx.
import { build } from "esbuild";

const workspaceScope = "@draft-loop/";

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  logLevel: "warning",
  // Some external packages are CommonJS and call `require`, which an ES module lacks.
  banner: {
    js: "import { createRequire as __draftLoopCreateRequire } from 'node:module'; const require = __draftLoopCreateRequire(import.meta.url);",
  },
  plugins: [
    {
      name: "external-third-party",
      setup(context) {
        // A bare specifier outside the workspace is a third-party package: leave it external.
        context.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith(workspaceScope) || args.path.startsWith("node:")
            ? undefined
            : { path: args.path, external: true },
        );
      },
    },
  ],
});
