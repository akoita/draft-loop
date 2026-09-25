import { pathToFileURL } from "node:url";

/**
 * Determines whether the running module is the process entry point.
 *
 * `import.meta.url` and `process.argv[1]` are compared as file URLs rather
 * than raw strings so the check is correct on Windows, where
 * `import.meta.url` uses `file:///C:/...` while `process.argv[1]` uses a
 * native `C:\...` path.
 */
export function isEntryPoint(
  moduleUrl: string,
  argv1: string | undefined,
  toFileUrl: (path: string) => string = (path) => pathToFileURL(path).href,
): boolean {
  if (argv1 === undefined || argv1.length === 0) {
    return false;
  }

  return moduleUrl === toFileUrl(argv1);
}
