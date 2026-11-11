import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApiDocument } from '../src/openapi.js';

const output = fileURLToPath(new URL('../openapi.json', import.meta.url));
writeFileSync(output, `${JSON.stringify(openApiDocument, null, 2)}\n`);
