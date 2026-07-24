/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { normalize } from "normalizr";
import { describe, expect, it } from "vitest";

import { RagHelperEntity } from "./entities";
import { EntityType, normalizeEntity } from "./types";

describe("RagHelper entity", () => {
  it("normalizes helpers by name", () => {
    expect(normalize([{ name: "fulltext-search" }], [RagHelperEntity])).toEqual(
      {
        entities: {
          [EntityType.RAG_HELPER]: {
            "fulltext-search": {
              name: "fulltext-search",
            },
          },
        },
        result: ["fulltext-search"],
      },
    );
  });

  it("is accepted by dynamic autocomplete entity normalization", () => {
    expect(normalizeEntity("RagHelper")).toBe(EntityType.RAG_HELPER);
  });
});
