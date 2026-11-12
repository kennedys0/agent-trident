import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// zod v4 attaches schema methods per instance, so this must run before any
// schema that later reaches the OpenAPI registry is constructed.
extendZodWithOpenApi(z);
