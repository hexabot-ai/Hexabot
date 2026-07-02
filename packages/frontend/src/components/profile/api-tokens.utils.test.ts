/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action, type ApiToken, type ApiTokenScope } from "@hexabot-ai/types";
import { describe, expect, it } from "vitest";

import {
  formatOptionalDate,
  formatScopeLabel,
  getApiTokenStatus,
  getScopeKey,
  groupScopesByModel,
  toApiTokenCreatePayload,
} from "./api-tokens.utils";

const baseToken = {
  expiresAt: null,
  revokedAt: null,
} as Pick<ApiToken, "expiresAt" | "revokedAt">;
const scopes: ApiTokenScope[] = [{ model: "workflow", action: Action.READ }];

describe("api token utils", () => {
  describe("getApiTokenStatus", () => {
    it("returns revoked before evaluating expiry", () => {
      expect(
        getApiTokenStatus(
          {
            ...baseToken,
            expiresAt: new Date("2026-01-01T00:00:00.000Z"),
            revokedAt: new Date("2025-01-01T00:00:00.000Z"),
          },
          new Date("2025-06-01T00:00:00.000Z"),
        ),
      ).toBe("revoked");
    });

    it("returns expired when the expiry is in the past", () => {
      expect(
        getApiTokenStatus(
          {
            ...baseToken,
            expiresAt: new Date("2025-01-01T00:00:00.000Z"),
          },
          new Date("2025-06-01T00:00:00.000Z"),
        ),
      ).toBe("expired");
    });

    it("returns active for non-revoked, non-expired tokens", () => {
      expect(
        getApiTokenStatus(
          {
            ...baseToken,
            expiresAt: new Date("2026-01-01T00:00:00.000Z"),
          },
          new Date("2025-06-01T00:00:00.000Z"),
        ),
      ).toBe("active");
      expect(getApiTokenStatus(baseToken)).toBe("active");
    });
  });

  it("trims token names and converts datetime-local values to ISO", () => {
    expect(
      toApiTokenCreatePayload({
        name: "  Codex  ",
        expiresAt: "2026-05-05T12:30",
        scopes,
      }),
    ).toEqual({
      name: "Codex",
      expiresAt: new Date("2026-05-05T12:30").toISOString(),
      scopes,
    });
  });

  it("uses null expiry when no datetime-local value is provided", () => {
    expect(toApiTokenCreatePayload({ name: "Codex", scopes })).toEqual({
      name: "Codex",
      expiresAt: null,
      scopes,
    });
  });

  describe("scope helpers", () => {
    it("derives a stable key and label from a scope", () => {
      const scope: ApiTokenScope = { model: "workflow", action: Action.READ };

      expect(getScopeKey(scope)).toBe("workflow:read");
      expect(formatScopeLabel(scope)).toBe("workflow:read");
    });

    it("groups scopes by model, sorted with actions in canonical order", () => {
      const grouped = groupScopesByModel([
        { model: "workflow", action: Action.READ },
        { model: "content", action: Action.DELETE },
        { model: "content", action: Action.CREATE },
        { model: "workflow", action: Action.CREATE },
      ]);

      expect(grouped).toEqual([
        { model: "content", actions: [Action.CREATE, Action.DELETE] },
        { model: "workflow", actions: [Action.CREATE, Action.READ] },
      ]);
    });

    it("returns an empty list when there are no grantable scopes", () => {
      expect(groupScopesByModel([])).toEqual([]);
    });
  });

  it("formats valid dates and ignores empty or invalid dates", () => {
    expect(formatOptionalDate(null)).toBeNull();
    expect(formatOptionalDate("not-a-date")).toBeNull();
    expect(formatOptionalDate("2026-05-05T12:30:00.000Z", "en-US")).toContain(
      "2026",
    );
  });
});
