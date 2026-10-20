import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ErrorObject, ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { load } from 'js-yaml';

const SPEC_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'spec', 'openapi.yaml');
const SCHEMA_ROOT_ID = 'openapi.yaml';
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

interface MediaObject {
  schema?: unknown;
  example?: unknown;
  examples?: Record<string, { summary?: string; value: unknown }>;
}

interface ResponseObject {
  $ref?: string;
  description?: string;
  headers?: Record<string, unknown>;
  content?: Record<string, MediaObject>;
}

interface ParameterObject {
  $ref?: string;
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  example?: unknown;
  schema?: { enum?: unknown[]; example?: unknown };
}

interface OperationObject {
  operationId?: string;
  deprecated?: boolean;
  security?: unknown[];
  parameters?: ParameterObject[];
  responses: Record<string, ResponseObject>;
}

interface OpenApiDocument {
  security?: unknown[];
  paths: Record<string, Partial<Record<(typeof METHODS)[number], OperationObject>> & { parameters?: ParameterObject[] }>;
  components: {
    responses: Record<string, ResponseObject>;
    parameters: Record<string, ParameterObject>;
  };
}

export const v4Spec = load(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;

export interface DocumentedResponse {
  /** JSON pointer (without `#`) of the response object, after following a `$ref`. */
  pointer: string;
  response: ResponseObject;
}

export interface Operation {
  /** The `operationId`, or `GET /radio` style for the few operations the spec leaves without one. */
  id: string;
  method: (typeof METHODS)[number];
  /** Path template as the spec writes it, e.g. `/channels/{id}/play`. */
  path: string;
  /** Whether the operation needs a session (the global `cookie_auth` unless it sets `security: []`). */
  requiresSession: boolean;
  deprecated: boolean;
  parameters: ParameterObject[];
  responses: Record<string, DocumentedResponse>;
}

const escapePointer = (segment: string) => segment.replace(/~/g, '~0').replace(/\//g, '~1');

function resolve<T extends { $ref?: string }>(item: T, pointer: string, pool: Record<string, T>): { item: T; pointer: string } {
  if (!item.$ref) return { item, pointer };
  const name = item.$ref.split('/').pop()!;
  return { item: pool[name], pointer: item.$ref.slice(1) };
}

const operations = new Map<string, Operation>();
for (const [pathTemplate, pathItem] of Object.entries(v4Spec.paths)) {
  for (const method of METHODS) {
    const op = pathItem[method];
    if (!op) continue;
    const responses: Record<string, DocumentedResponse> = {};
    for (const [status, raw] of Object.entries(op.responses)) {
      const { item, pointer } = resolve(
        raw,
        `/paths/${escapePointer(pathTemplate)}/${method}/responses/${status}`,
        v4Spec.components.responses,
      );
      responses[status] = { pointer, response: item };
    }
    const id = op.operationId ?? `${method.toUpperCase()} ${pathTemplate}`;
    operations.set(id, {
      id,
      method,
      path: pathTemplate,
      requiresSession: (op.security ?? v4Spec.security ?? []).length > 0,
      deprecated: Boolean(op.deprecated),
      // Path-level parameters (e.g. `{id}` of /profiles/{id}) apply to every operation under it.
      parameters: [...(pathItem.parameters ?? []), ...(op.parameters ?? [])].map(
        (p) => resolve(p, '', v4Spec.components.parameters).item,
      ),
      responses,
    });
  }
}

/** The operation with this `operationId`; throws on a typo instead of silently checking nothing. */
export function operation(id: string): Operation {
  const op = operations.get(id);
  if (!op) throw new Error(`No operation "${id}" in ${SPEC_PATH}`);
  return op;
}

/** The `enum` the spec gives parameter `name` of `operationId` (e.g. the services a path accepts). */
export function parameterEnum(operationId: string, name: string): string[] {
  const values = operation(operationId).parameters.find((p) => p.name === name)?.schema?.enum;
  if (!values) throw new Error(`${operationId} has no enum parameter "${name}"`);
  return values.map(String);
}

export function allOperations(): Operation[] {
  return [...operations.values()];
}

/**
 * The operation a concrete path (`/api/v4/blocks/playback` or `blocks/playback`)
 * belongs to. A literal segment beats a `{parameter}`, so `/pages/tv` is getTvPage,
 * not getPage.
 */
export function operationForPath(method: string, concretePath: string): Operation | undefined {
  const segments = concretePath.replace(/^\/?(api\/v4\/)?/, '').split('?')[0].split('/');
  const matches = allOperations().filter((op) => {
    const template = op.path.slice(1).split('/');
    return (
      op.method === method.toLowerCase() &&
      template.length === segments.length &&
      template.every((part, i) => part.startsWith('{') || part === segments[i])
    );
  });
  const literals = (op: Operation) => op.path.split('/').filter((part) => part && !part.startsWith('{')).length;
  return matches.sort((a, b) => literals(b) - literals(a))[0];
}

// OpenAPI 3.1+ schemas use the JSON Schema 2020-12 dialect (see src/schema/validator.ts).
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(v4Spec, SCHEMA_ROOT_ID);

const validatorCache = new Map<string, ValidateFunction>();

function validatorAt(pointer: string): ValidateFunction {
  const cached = validatorCache.get(pointer);
  if (cached) return cached;
  const validate = ajv.getSchema(`${SCHEMA_ROOT_ID}#${pointer}`);
  if (!validate) throw new Error(`No schema at ${pointer} in ${SPEC_PATH}`);
  validatorCache.set(pointer, validate);
  return validate;
}

export interface ResponseCheck {
  /** A mismatch no schema check can describe: undocumented status, wrong media type, unexpected body. */
  problem?: string;
  errors: ErrorObject[];
}

/** Checks a live response against what `operationId` documents for `status`. */
export function checkResponse(operationId: string, status: number, contentType: string, body: unknown): ResponseCheck {
  const op = operation(operationId);
  const documented = op.responses[String(status)];
  if (!documented) {
    return { problem: `status ${status} is not documented (documented: ${Object.keys(op.responses).join(', ')})`, errors: [] };
  }
  const mediaTypes = Object.keys(documented.response.content ?? {});
  if (mediaTypes.length === 0) {
    return body === null ? { errors: [] } : { problem: `status ${status} documents no body, got one`, errors: [] };
  }
  const mediaType = mediaTypes.find((type) => contentType.split(';')[0].trim() === type);
  if (!mediaType) {
    return { problem: `Content-Type "${contentType}" is not one of ${mediaTypes.join(', ')}`, errors: [] };
  }
  const validate = validatorAt(`${documented.pointer}/content/${escapePointer(mediaType)}/schema`);
  return { errors: validate(body) ? [] : [...(validate.errors ?? [])] };
}

/** Names of the headers `operationId` documents for `status` (empty when the status isn't documented). */
export function documentedHeaders(operationId: string, status: number): string[] {
  return Object.keys(operation(operationId).responses[String(status)]?.response.headers ?? {});
}

export function formatSchemaErrors(errors: ErrorObject[]): string {
  return ajv.errorsText(errors, { separator: '\n', dataVar: 'response' });
}

export interface DocumentedExample {
  operationId: string;
  status: string;
  mediaType: string;
  name: string;
  value: unknown;
}

/** Every `example` / `examples` entry of every documented response. */
export function documentedExamples(): DocumentedExample[] {
  const result: DocumentedExample[] = [];
  for (const op of operations.values()) {
    for (const [status, { response }] of Object.entries(op.responses)) {
      for (const [mediaType, media] of Object.entries(response.content ?? {})) {
        if ('example' in media) result.push({ operationId: op.id, status, mediaType, name: 'example', value: media.example });
        for (const [name, example] of Object.entries(media.examples ?? {})) {
          result.push({ operationId: op.id, status, mediaType, name, value: example.value });
        }
      }
    }
  }
  return result;
}

/** Validates a documented example against the schema it illustrates. */
export function checkExample(example: DocumentedExample): ErrorObject[] {
  const { pointer } = operation(example.operationId).responses[example.status];
  const validate = validatorAt(`${pointer}/content/${escapePointer(example.mediaType)}/schema`);
  return validate(example.value) ? [] : [...(validate.errors ?? [])];
}
