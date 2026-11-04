// Packaged acceptance for the desktop client (ADR 0011, D9; issue #2093). It launches the
// packaged client with a fresh profile against a scripted fake DraftLoop API on this computer
// and checks the picker, the server window's isolation and navigation rules, and a relaunch.
// No provider, no real server and no candidate material are involved.
//
// Usage: node scripts/desktop-client-acceptance.mjs [packaged executable] [evidence.json]
// Without an executable it uses the one `pnpm --filter @draft-loop/desktop-client package` wrote.
/* global console, document, location, setTimeout, URL -- Node and the pages under test. */
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { _electron as electron } from "playwright-core";

const fakePage = `<!doctype html><title>DraftLoop acceptance server</title>
<h1 id="ready">Acceptance server</h1>
<a id="outside" href="https://docs.example.test/help">Help</a>
<script>
  const desktop = window.draftLoopDesktop;
  document.body.dataset.host = desktop && desktop.host;
  document.body.dataset.node = typeof require + "," + typeof process;
  document.body.dataset.signin = desktop && desktop.signIn ? typeof desktop.signIn.remember : "none";
</script>`;

function startFakeServer() {
  const server = createServer((request, response) => {
    if (request.url === "/v1/health") {
      response.setHeader("content-type", "application/json");
      response.end('{"status":"ok"}');
    } else if (request.url === "/v1/auth/config") {
      response.setHeader("content-type", "application/json");
      response.end('{"mode":"owner"}');
    } else {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(fakePage);
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise(server));
  });
}

/**
 * Seeds a first-launch profile that lists "This computer" with nothing selected. A fresh
 * profile would select 127.0.0.1:8080 and open whatever server answers there, such as the
 * person's own self-hosted stack, instead of the picker (#2112). The list itself is the
 * one a first launch shows.
 */
export async function seedFirstLaunchProfile(userData) {
  await mkdir(userData, { recursive: true });
  const list = { servers: [{ origin: "http://127.0.0.1:8080", name: "This computer" }] };
  await writeFile(join(userData, "servers.json"), `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

/** Keeps the client off the release check, so no dialog opens during the run. */
function clientEnvironment() {
  return { ...process.env, DRAFT_LOOP_DESKTOP_RELEASE_CHECK: "off" };
}

async function launch(executablePath, userData) {
  // A fresh profile through Chromium's own switch, which Electron honours on every platform.
  const args = [
    `--user-data-dir=${userData}`,
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  ];
  const env = clientEnvironment();
  const app = await electron.launch({ executablePath, args, env, timeout: 60_000 });
  // Links the client sends outside are recorded instead of opening a browser.
  await app.evaluate(({ shell }) => {
    globalThis.acceptanceOpened = [];
    shell.openExternal = async (url) => {
      globalThis.acceptanceOpened.push(url);
    };
  });
  return app;
}

async function lastWindowWith(app, selector) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const window of app.windows().toReversed()) {
      if (!window.isClosed() && (await window.$(selector).catch(() => null)) !== null)
        return window;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`No window showed ${selector}.`);
}

/** The executable the client's `package` script wrote for this platform. */
export async function findPackagedClient(outDirectory = resolve("apps/desktop-client/out")) {
  const entries = await readdir(outDirectory, { recursive: true, withFileTypes: true });
  const executable = entries.find((entry) => {
    if (!entry.isFile()) return false;
    const path = join(entry.parentPath, entry.name);
    if (process.platform === "darwin") return /\.app\/Contents\/MacOS\/[^/]+$/u.test(path);
    return entry.name === (process.platform === "win32" ? "draftloop.exe" : "draftloop");
  });
  if (executable === undefined)
    throw new Error(`No packaged client in ${outDirectory}; run the package script first.`);
  return join(executable.parentPath, executable.name);
}

async function main() {
  const [executableArgument, evidenceArgument] = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  const executablePath =
    executableArgument === undefined ? await findPackagedClient() : resolve(executableArgument);
  const checks = {};
  const server = await startFakeServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(join(tmpdir(), "draftloop-client-acceptance-"));
  const userData = join(profile, "user-data");
  try {
    await seedFirstLaunchProfile(userData);
    let app = await launch(executablePath, userData);
    const picker = await lastWindowWith(app, "#add");
    checks.pickerAtFirstLaunch = picker.url().startsWith("file:");

    await picker.fill("#address", "http://192.0.2.10:8080");
    await picker.click("#add button[type=submit]");
    await picker.waitForFunction(() => document.getElementById("add-error")?.textContent !== "");
    checks.refusesPlainHttpElsewhere = (await picker.textContent("#add-error")).includes(
      "https://",
    );

    await picker.fill("#address", origin);
    await picker.fill("#name", "Acceptance");
    await picker.click("#add button[type=submit]");
    let window = await lastWindowWith(app, "#ready");
    checks.opensServer = new URL(window.url()).origin === origin;
    const body = await window.evaluate(() => ({ ...document.body.dataset }));
    checks.desktopHost = body.host === "desktop";
    checks.noNodeInPage = body.node === "undefined,undefined";
    checks.signInHook = body.signin === "function";

    await window.click("#outside", { noWaitAfter: true });
    await window.waitForTimeout(500);
    const opened = await app.evaluate(() => globalThis.acceptanceOpened);
    checks.outsideLinksLeave =
      new URL(window.url()).origin === origin && opened.includes("https://docs.example.test/help");
    checks.otherSchemesBlocked = await window.evaluate(async () => {
      location.href = "file:///";
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
      return location.protocol === "http:";
    });
    await app.close();

    app = await launch(executablePath, userData);
    window = await lastWindowWith(app, "#ready");
    checks.relaunchOpensLastServer = new URL(window.url()).origin === origin;
    await app.close();
  } finally {
    server.close();
    await rm(profile, { recursive: true, force: true });
  }
  const failed = Object.entries(checks).filter(([, passed]) => passed !== true);
  const evidence = {
    platform: process.platform,
    arch: process.arch,
    checks,
    passed: failed.length === 0,
  };
  if (evidenceArgument !== undefined) {
    await mkdir(dirname(resolve(evidenceArgument)), { recursive: true });
    await writeFile(resolve(evidenceArgument), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
  if (failed.length > 0)
    throw new Error(`Failed checks: ${failed.map(([name]) => name).join(", ")}`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
