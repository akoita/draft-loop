import { writeFile } from "node:fs/promises";

import { apiTypesPath, generateApiTypes } from "./api-types-generator.js";

await writeFile(apiTypesPath, await generateApiTypes(), "utf8");
