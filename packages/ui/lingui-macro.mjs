/**
 * The build step that turns Lingui's `t` and `Trans` macros into catalog lookups (#2321), for the
 * web screen's Vite build and the repository's Vitest run. Only files that import a Lingui macro
 * go through Babel; the rest keep Vite's own fast transform.
 */
import babel from "@rolldown/plugin-babel";

const macroImport = /@lingui\/(?:core|react)\/macro/;

export async function linguiMacro() {
  const plugin = await babel({
    plugins: ["@lingui/babel-plugin-lingui-macro"],
    parserOpts: { plugins: ["typescript", "jsx"] },
  });
  const transform = plugin.transform;
  const handler = typeof transform === "function" ? transform : transform?.handler;
  return {
    ...plugin,
    name: "draft-loop-lingui-macro",
    enforce: "pre",
    transform(code, id, options) {
      if (handler === undefined || !macroImport.test(code)) return null;
      return handler.call(this, code, id, options);
    },
  };
}
