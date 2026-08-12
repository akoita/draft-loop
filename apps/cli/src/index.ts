import { Command } from "commander";

export function createCli(): Command {
  return new Command()
    .name("draft-loop")
    .description("Local-first CV drafting and review workspace")
    .version("0.1.0");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await createCli().parseAsync();
}
