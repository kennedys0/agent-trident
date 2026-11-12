import assert from 'node:assert/strict';
import { test } from 'node:test';
// Regression guard for the zod v4 per-instance OpenAPI extension: zod v4
// attaches schema methods per instance, so a module that builds schemas
// without importing ./zod-openapi.js first loses .openapi() at runtime
// (a TypeError during generation, invisible to typecheck). Importing the
// contract entry in a clean process must leave every public schema with a
// working .openapi() and the document must still generate.
import {
  auditEventSchema,
  paperFillSchema,
  riskDecisionSchema,
  tradeIntentSchema,
} from '../src/index.js';
import { openApiDocument } from '../src/openapi.js';

const hasOpenapi = (schema: object): boolean =>
  typeof (schema as Record<string, unknown>).openapi === 'function';

test('contract entry keeps .openapi() on public schemas (zod v4 per-instance extension)', () => {
  for (const schema of [tradeIntentSchema, riskDecisionSchema, auditEventSchema, paperFillSchema]) {
    assert.ok(hasOpenapi(schema), 'schema lost .openapi(); a schema module probably skipped the zod-openapi side-effect import');
  }
});

test('openapi document still generates after nullable union dedup', () => {
  assert.equal(openApiDocument.openapi, '3.1.0');
  const components = (openApiDocument.components?.schemas ?? {}) as Record<string, unknown>;
  assert.ok(Object.keys(components).length >= 16, 'expected the 16 registered contract schemas in the generated document');
});
