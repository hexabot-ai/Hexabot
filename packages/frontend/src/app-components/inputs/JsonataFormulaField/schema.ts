/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { GlobalsSchema, JsonSchemaLike } from "./types";

export function schemaTypeHas(schema: JsonSchemaLike | undefined, t: string) {
  const type = schema?.type;

  if (!type) return false;

  return Array.isArray(type) ? type.includes(t) : type === t;
}

export function extractGlobals(globalsSchema: GlobalsSchema): {
  root: JsonSchemaLike;
  input?: JsonSchemaLike;
  output?: JsonSchemaLike;
  context?: JsonSchemaLike;
} {
  // Option C: direct map
  if (
    typeof (globalsSchema as any)?.input === "object" &&
    typeof (globalsSchema as any)?.output === "object" &&
    typeof (globalsSchema as any)?.context === "object" &&
    !(globalsSchema as any)?.properties
  ) {
    return {
      root: globalsSchema as any,
      input: (globalsSchema as any).input,
      output: (globalsSchema as any).output,
      context: (globalsSchema as any).context,
    };
  }

  const root = globalsSchema as JsonSchemaLike;
  const props = (globalsSchema as any)?.properties ?? {};

  return {
    root,
    input: props.$input ?? props.input,
    output: props.$output ?? props.output,
    context: props.$context ?? props.context,
  };
}

function resolveRef(
  root: JsonSchemaLike,
  ref?: string,
): JsonSchemaLike | undefined {
  if (!ref) return undefined;
  if (!ref.startsWith("#/")) return undefined;

  const path = ref.slice(2).split("/").filter(Boolean);
  let node: any = root;

  for (const p of path) node = node?.[p];

  return node as JsonSchemaLike | undefined;
}

export function deref(
  root: JsonSchemaLike,
  schema?: JsonSchemaLike,
): JsonSchemaLike | undefined {
  if (!schema) return undefined;
  if (!schema.$ref) return schema;

  const resolved = resolveRef(root, schema.$ref);

  if (!resolved) return schema;

  // merge: resolved base + local overrides (excluding $ref)
  const { $ref: _, ...rest } = schema;

  return { ...resolved, ...rest };
}

function variantsOf(schema: JsonSchemaLike): JsonSchemaLike[] {
  const out: JsonSchemaLike[] = [];

  if (schema.allOf?.length) out.push(...schema.allOf);
  if (schema.anyOf?.length) out.push(...schema.anyOf);
  if (schema.oneOf?.length) out.push(...schema.oneOf);

  return out;
}

export function getItemsSchema(
  root: JsonSchemaLike,
  schema: JsonSchemaLike,
): JsonSchemaLike | undefined {
  const items = schema.items;

  if (!items) return undefined;
  const first = Array.isArray(items) ? items[0] : items;

  return deref(root, first);
}

export function getPropertySchema(
  root: JsonSchemaLike,
  schema: JsonSchemaLike,
  key: string,
): JsonSchemaLike | undefined {
  const direct = schema.properties?.[key];

  if (direct) return deref(root, direct);

  // try union branches
  const vars = variantsOf(schema);
  const candidates: JsonSchemaLike[] = [];

  for (const v of vars) {
    const vv = deref(root, v);
    const p = vv?.properties?.[key];

    if (p) candidates.push(deref(root, p)!);
  }

  // additionalProperties schema fallback
  if (
    candidates.length === 0 &&
    typeof schema.additionalProperties === "object"
  ) {
    return deref(root, schema.additionalProperties as JsonSchemaLike);
  }

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return { anyOf: candidates };

  return undefined;
}

export function getPropertyKeys(
  root: JsonSchemaLike,
  schema: JsonSchemaLike,
): string[] {
  const keys = new Set<string>();
  const addFrom = (s?: JsonSchemaLike) => {
    if (!s) return;
    const ss = deref(root, s) ?? s;

    Object.keys(ss.properties ?? {}).forEach((k) => keys.add(k));

    for (const v of variantsOf(ss)) {
      const vv = deref(root, v);

      Object.keys(vv?.properties ?? {}).forEach((k) => keys.add(k));
    }
  };

  addFrom(schema);

  return Array.from(keys).sort();
}
