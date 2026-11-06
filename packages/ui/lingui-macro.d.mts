import type { Plugin } from "vite";

/** The Vite plugin that compiles the screens' Lingui macros (#2321). */
export declare function linguiMacro(): Promise<Plugin>;
