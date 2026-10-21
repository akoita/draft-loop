import { writeFile } from "node:fs/promises";

import { generateOpenApiDocument, openApiDocumentPath } from "./openapi-document.js";

await writeFile(openApiDocumentPath, await generateOpenApiDocument(), "utf8");
