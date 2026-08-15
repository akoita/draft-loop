import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, describe, test } from "node:test";
import { main, parseArguments } from "./desktop-live-e2e.mjs";

const anthropicVariable = "ANTHROPIC_API_KEY";
const openaiVariable = "OPENAI_API_KEY";
const anthropicPlaceholder = "synthetic-anthropic-credential";
const openaiPlaceholder = "synthetic-openai-credential";
const missingExecutable = join(tmpdir(), "draft-loop-live-e2e-missing-executable");

const temporaryDirectories = [];
const savedCredentials = {
  [anthropicVariable]: process.env[anthropicVariable],
  [openaiVariable]: process.env[openaiVariable],
};

afterEach(() => {
  for (const [variable, value] of Object.entries(savedCredentials)) {
    if (value === undefined) delete process.env[variable];
    else process.env[variable] = value;
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function setCredentials({ anthropic, openai }) {
  if (anthropic === undefined) delete process.env[anthropicVariable];
  else process.env[anthropicVariable] = anthropic;
  if (openai === undefined) delete process.env[openaiVariable];
  else process.env[openaiVariable] = openai;
}

function createTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "draft-loop-live-e2e-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function streams() {
  const result = { stdout: "", stderr: "" };
  return {
    result,
    stdout: {
      write(value) {
        result.stdout += value;
      },
    },
    stderr: {
      write(value) {
        result.stderr += value;
      },
    },
  };
}

describe("desktop live E2E argument parsing", () => {
  test("keeps dev mode for flag-only invocations", () => {
    assert.deepEqual(parseArguments([]), {
      help: false,
      keep: false,
      executable: undefined,
      evidence: undefined,
    });
    assert.deepEqual(parseArguments(["--", "--keep"]), {
      help: false,
      keep: true,
      executable: undefined,
      evidence: undefined,
    });
    assert.deepEqual(parseArguments(["--keep-workspace"]), {
      help: false,
      keep: true,
      executable: undefined,
      evidence: undefined,
    });
  });

  test("parses one and two positional arguments", () => {
    assert.deepEqual(parseArguments(["/packaged/draft-loop"]), {
      help: false,
      keep: false,
      executable: "/packaged/draft-loop",
      evidence: undefined,
    });
    assert.deepEqual(parseArguments(["/packaged/draft-loop", "evidence/live-e2e.json"]), {
      help: false,
      keep: false,
      executable: "/packaged/draft-loop",
      evidence: "evidence/live-e2e.json",
    });
  });

  test("combines --keep with positional arguments in any order", () => {
    assert.deepEqual(
      parseArguments(["--", "--keep", "/packaged/draft-loop", "evidence/live-e2e.json"]),
      {
        help: false,
        keep: true,
        executable: "/packaged/draft-loop",
        evidence: "evidence/live-e2e.json",
      },
    );
    assert.deepEqual(parseArguments(["/packaged/draft-loop", "--keep"]), {
      help: false,
      keep: true,
      executable: "/packaged/draft-loop",
      evidence: undefined,
    });
  });

  test("returns help without positional arguments", () => {
    assert.deepEqual(parseArguments(["--help"]), {
      help: true,
      keep: false,
      executable: undefined,
      evidence: undefined,
    });
  });

  test("rejects unknown flags and extra positional arguments", () => {
    assert.throws(() => parseArguments(["--nope"]), /unknown argument: --nope/);
    assert.throws(() => parseArguments(["-x"]), /unknown argument: -x/);
    assert.throws(
      () => parseArguments(["/packaged/draft-loop", "evidence.json", "extra"]),
      /unexpected argument: extra/,
    );
  });
});

describe("desktop live E2E CLI", () => {
  test("prints usage for --help", async () => {
    const io = streams();

    const exitCode = await main(["--help"], { stdout: io.stdout, stderr: io.stderr });

    assert.equal(exitCode, 0);
    assert.equal(io.result.stderr, "");
    assert.match(io.result.stdout, /Usage: pnpm test:e2e:live \[--keep\]/u);
  });

  test("fails closed when packaged mode has no Anthropic credential", async () => {
    setCredentials({ anthropic: undefined, openai: openaiPlaceholder });
    const io = streams();

    const exitCode = await main([missingExecutable], { stdout: io.stdout, stderr: io.stderr });

    assert.equal(exitCode, 1);
    assert.equal(io.result.stdout, "");
    assert.match(io.result.stderr, /requires ANTHROPIC_API_KEY in the environment/u);
    assert.equal(io.result.stderr.includes(openaiPlaceholder), false);
  });

  test("fails closed when packaged mode has an empty OpenAI credential", async () => {
    setCredentials({ anthropic: anthropicPlaceholder, openai: "   " });
    const io = streams();

    const exitCode = await main([missingExecutable], { stdout: io.stdout, stderr: io.stderr });

    assert.equal(exitCode, 1);
    assert.equal(io.result.stdout, "");
    assert.match(io.result.stderr, /requires OPENAI_API_KEY in the environment/u);
    assert.equal(io.result.stderr.includes(anthropicPlaceholder), false);
  });

  test("rejects a packaged executable that cannot be read", async () => {
    setCredentials({ anthropic: anthropicPlaceholder, openai: openaiPlaceholder });
    const io = streams();

    const exitCode = await main([missingExecutable], { stdout: io.stdout, stderr: io.stderr });

    assert.equal(exitCode, 1);
    assert.equal(io.result.stdout, "");
    assert.match(io.result.stderr, /packaged live E2E executable could not be read/u);
    assert.equal(io.result.stderr.includes(anthropicPlaceholder), false);
    assert.equal(io.result.stderr.includes(openaiPlaceholder), false);
  });

  test("rejects a packaged executable that is not a file", async () => {
    setCredentials({ anthropic: anthropicPlaceholder, openai: openaiPlaceholder });
    const directory = createTemporaryDirectory();
    const io = streams();

    const exitCode = await main([directory], { stdout: io.stdout, stderr: io.stderr });

    assert.equal(exitCode, 1);
    assert.equal(io.result.stdout, "");
    assert.match(io.result.stderr, /packaged live E2E executable must be a file/u);
  });

  test("reports unknown flags without launching anything", async () => {
    setCredentials({ anthropic: undefined, openai: undefined });
    const io = streams();

    const exitCode = await main(["--nope"], { stdout: io.stdout, stderr: io.stderr });

    assert.equal(exitCode, 1);
    assert.equal(io.result.stdout, "");
    assert.match(io.result.stderr, /unknown argument: --nope/u);
  });
});
