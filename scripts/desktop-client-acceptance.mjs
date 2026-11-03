// Packaged acceptance for the desktop client (ADR 0011, D9; issue #2093). It launches the
// packaged client with a fresh profile against a scripted fake DraftLoop API on this computer
// and checks the picker, the server window's isolation and navigation rules, and a relaunch.
// No provider, no real server and no candidate material are involved.
//
// Usage: node scripts/desktop-client-acceptance.mjs <packaged executable> [evidence.json]
/* global console, document, location, setTimeout, URL -- Node and the pages under test. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

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

function profileEnvironment(profile) {
  return {
    ...process.env,
    HOME: profile,
    USERPROFILE: profile,
    APPDATA: join(profile, "AppData", "Roaming"),
    LOCALAPPDATA: join(profile, "AppData", "Local"),
    XDG_CONFIG_HOME: join(profile, ".config"),
  };
}

async function launch(executablePath, env) {
  const args = process.platform === "linux" ? ["--no-sandbox"] : [];
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

async function main() {
  const [executableArgument, evidenceArgument] = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  if (executableArgument === undefined) throw new Error("Pass the packaged client's executable.");
  const executablePath = resolve(executableArgument);
  const checks = {};
  const server = await startFakeServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(join(tmpdir(), "draftloop-client-acceptance-"));
  const env = profileEnvironment(profile);
  try {
    let app = await launch(executablePath, env);
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

    app = await launch(executablePath, env);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
