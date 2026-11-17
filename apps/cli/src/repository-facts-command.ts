import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  collectRepositoryFacts,
  RepositoryFactsError,
} from "@draft-loop/application/repository-facts";
import type { Command } from "commander";

import { type ApplicationIo, CliUserError } from "./workflow.js";

const run = promisify(execFile);

/**
 * `draft-loop evidence add-repo <path>` (#2896): prints a project card's counted fields for one
 * local repository as JSON, from git and its root manifests, with no model call and nothing sent
 * anywhere. An agent or the candidate adds the purpose, summary and highlights, then files the
 * card with `add_project`.
 */
export function registerRepositoryFactsCommand(root: Command, io: ApplicationIo): void {
  const evidence =
    root.commands.find((command) => command.name() === "evidence") ??
    root.command("evidence").description("Career evidence commands");
  evidence
    .command("add-repo")
    .description(
      "Print a project card's counted fields for a local git repository as JSON, with no model call",
    )
    .argument("<path>", "the repository's directory")
    .requiredOption(
      "--email <email...>",
      "the candidate's commit emails; their commits are counted, and no email is printed",
    )
    .action(async (path: string, options: { email: string[] }) => {
      const directory = resolve(path);
      try {
        const facts = await collectRepositoryFacts(
          {
            git: async (args) =>
              (
                await run("git", ["-C", directory, ...args], {
                  maxBuffer: 64 * 1024 * 1024,
                  encoding: "utf8",
                })
              ).stdout,
            readFile: (file) => readFile(join(directory, file), "utf8").catch(() => undefined),
          },
          { emails: options.email, fallbackName: basename(directory) },
        );
        io.write(JSON.stringify(facts, null, 2));
      } catch (error) {
        if (error instanceof RepositoryFactsError) throw new CliUserError(error.message);
        throw new CliUserError(`${directory} is not a git repository with commits.`);
      }
    });
}
