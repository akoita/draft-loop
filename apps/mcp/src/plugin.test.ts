import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createApplicationsApi } from "./applications.js";
import { createWorkJournalApi, createWorkspaceApiCall } from "./client.js";
import { createDraftsApi } from "./drafts.js";
import { createRunsApi } from "./runs.js";
import { logWorkSkill } from "./init.js";
import { createWorkJournalMcpServer } from "./server.js";

/**
 * The Claude Code plugin and its marketplace in this repository (#2441): the manifests parse and
 * agree, the server starts the same command `init` writes, and every skill names only tools the
 * server offers. The same folder is also an Agent Plugins 1.0.0 package (#2537): a root
 * `plugin.json` and `mcp.json` beside Claude Code's own files, which must say the same.
 */

/**
 * The closed field sets of the Agent Plugins 1.0.0 schemas, copied from
 * https://agent-plugins.org/schemas/1.0.0/plugin.schema.json and mcp.schema.json. Tests never
 * fetch a schema, as the specification forbids clients to while loading a plugin.
 */
const agentPlugins = {
  pluginSchema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  mcpSchema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  manifestFields: [
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
  ],
  authorFields: ["name", "email", "url"],
  namePattern: /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u,
  stdioFields: ["type", "command", "args", "env", "cwd"],
} as const;

const repository = join(import.meta.dirname, "..", "..", "..");
const plugin = join(repository, "plugins", "draftloop");

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function toolNames(): Promise<readonly string[]> {
  const config = {
    baseUrl: "http://127.0.0.1:8080",
    workspaceId: "owner",
    token: async () => undefined,
  };
  const server = createWorkJournalMcpServer(
    createWorkJournalApi(config),
    createApplicationsApi(createWorkspaceApiCall(config)),
    createDraftsApi(createWorkspaceApiCall(config)),
    createRunsApi(createWorkspaceApiCall(config)),
  );
  const client = new Client({ name: "test-host", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => tool.name);
}

describe("the DraftLoop Claude Code plugin", () => {
  it("is listed by the repository's marketplace under its own folder", async () => {
    const marketplace = await json(join(repository, ".claude-plugin", "marketplace.json"));
    const manifest = await json(join(plugin, ".claude-plugin", "plugin.json"));
    expect(marketplace.name).toBe("draftloop");
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: manifest.name, source: "./plugins/draftloop" }),
    ]);
    expect(manifest.name).toBe("draftloop");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("starts draftloop-mcp with no token in its configuration", async () => {
    const mcp = await json(join(plugin, ".mcp.json"));
    expect(mcp).toEqual({
      mcpServers: {
        draftloop: {
          command: "draftloop-mcp",
          env: { DRAFT_LOOP_SERVER_URL: "${DRAFT_LOOP_SERVER_URL:-http://127.0.0.1:8080}" },
        },
      },
    });
    const hooks = await readFile(join(plugin, "hooks", "hooks.json"), "utf8");
    expect(JSON.parse(hooks).hooks.Stop[0].hooks[0].command).toBe("draftloop-mcp hook stop");
    expect(`${JSON.stringify(mcp)}${hooks}`).not.toMatch(/dlagent_|TOKEN/u);
  });

  it("ships the same /log-work skill as init, and skills that name only offered tools", async () => {
    expect(await readFile(join(plugin, "skills", "log-work", "SKILL.md"), "utf8")).toBe(
      logWorkSkill,
    );
    const offered = new Set(await toolNames());
    expect((await readdir(join(plugin, "skills"))).sort()).toEqual([
      "applications",
      "log-work",
      "start-run",
      "status",
      "tailor-cv",
    ]);
    for (const skill of ["log-work", "tailor-cv", "applications", "status", "start-run"]) {
      const text = await readFile(join(plugin, "skills", skill, "SKILL.md"), "utf8");
      expect(text, skill).toMatch(
        new RegExp(`^---\\nname: ${skill}\\ndescription: .+\\n---\\n`, "u"),
      );
      const named = [...text.matchAll(/\b[Cc]all `([a-z_]+)`/gu)].map((match) => match[1] ?? "");
      expect(named.length, skill).toBeGreaterThan(0);
      for (const tool of named) expect(offered, `${skill} names ${tool}`).toContain(tool);
    }
  });

  it("is also an Agent Plugins 1.0.0 package that says what the Claude Code files say", async () => {
    const portable = await json(join(plugin, "plugin.json"));
    const claude = await json(join(plugin, ".claude-plugin", "plugin.json"));
    expect(portable.$schema).toBe(agentPlugins.pluginSchema);
    for (const field of Object.keys(portable)) {
      expect(agentPlugins.manifestFields, field).toContain(field);
    }
    for (const field of Object.keys(portable.author as object)) {
      expect(agentPlugins.authorFields, field).toContain(field);
    }
    expect(portable.name).toMatch(agentPlugins.namePattern);
    expect(String(portable.name).length).toBeLessThanOrEqual(64);
    const { $schema: _schema, ...portableFields } = portable;
    expect(portableFields).toEqual(claude);

    const mcp = await json(join(plugin, "mcp.json"));
    const claudeMcp = await json(join(plugin, ".mcp.json"));
    expect(Object.keys(mcp).sort()).toEqual(["$schema", "mcpServers"]);
    expect(mcp.$schema).toBe(agentPlugins.mcpSchema);
    const servers = mcp.mcpServers as Record<string, Record<string, unknown>>;
    const claudeServers = claudeMcp.mcpServers as Record<string, Record<string, unknown>>;
    expect(Object.keys(servers)).toEqual(Object.keys(claudeServers));
    for (const [name, server] of Object.entries(servers)) {
      for (const field of Object.keys(server)) {
        expect(agentPlugins.stdioFields, `${name}.${field}`).toContain(field);
      }
      expect(server.type).toBe("stdio");
      expect(server.command).toBe(claudeServers[name]?.command);
      // The format expands no variable but its own placeholders, so the portable entry relies on
      // draftloop-mcp's default server address and holds no token.
      expect(JSON.stringify(server)).not.toMatch(/\$\{|dlagent_|TOKEN/u);
    }
  });

  it("names each skill after its folder, as Agent Skills require", async () => {
    for (const skill of await readdir(join(plugin, "skills"))) {
      const text = await readFile(join(plugin, "skills", skill, "SKILL.md"), "utf8");
      expect(text.match(/^name: (.+)$/mu)?.[1], skill).toBe(skill);
      expect(skill).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    }
  });
});
