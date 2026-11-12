/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it } from "vitest";

import {
  EDGE_TYPES,
  EEdgeType,
  ENodeType,
  NODE_TYPES,
  getWorkflowDefaultConfig,
} from "./index";

describe("@hexabot-ai/graph", () => {
  it("exposes workflow graph utilities", () => {
    const config = getWorkflowDefaultConfig("horizontal");

    expect(config.nodes[ENodeType.TASK]).toBeDefined();
    expect(config.nodes[ENodeType.BINDING_MULTI]).toBeDefined();
    expect(config.edges).toBeDefined();
  });

  it("registers a renderer for every node and edge type", () => {
    expect(Object.keys(NODE_TYPES).sort()).toEqual(
      Object.values(ENodeType).sort(),
    );
    expect(Object.keys(EDGE_TYPES)).toEqual(Object.values(EEdgeType));
  });
});
