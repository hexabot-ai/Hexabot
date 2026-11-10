/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z } from "zod";

import { cloneWithPrototype, toRecord } from "./object";
import { preprocess } from "./preprocess";

export const withAliases = (
  value: unknown,
  aliases: Record<string, string>,
): unknown => {
  const record = toRecord(value);
  if (!record) {
    return value;
  }

  const next = cloneWithPrototype(record);

  for (const [from, to] of Object.entries(aliases)) {
    if (next[to] === undefined && next[from] !== undefined) {
      next[to] = next[from];
    }
  }

  return next;
};

export const asId = (value: unknown): unknown => {
  if (value == null || typeof value === "string") {
    return value;
  }

  const record = toRecord(value);
  if (!record) {
    return value;
  }

  return typeof record.id === "string" ? record.id : value;
};

const asIdArray = (value: unknown): unknown => {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((entry) => asId(entry));
};

/** A relation given as an id or a populated entity, kept as its id. */
export const nullableIdSchema = preprocess(
  (value) => (value == null ? null : asId(value)),
  z.string().nullable(),
);

/** A list of relations given as ids or populated entities, kept as ids. */
export const idArraySchema = preprocess(
  (value) => (Array.isArray(value) ? asIdArray(value) : []),
  z.array(z.string()),
);
