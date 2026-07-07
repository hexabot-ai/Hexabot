/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { describe, expect, it, vi } from "vitest";

import type { ISettingSchemasMap } from "@/types/setting.types";

import { resolveSettingsGroupTitle } from "./settings.utils";

describe("settings utils", () => {
  describe("resolveSettingsGroupTitle", () => {
    it("returns localized schema title when available", () => {
      const schemas: ISettingSchemasMap = {
        web: {
          schema: {
            title: "Web Channel",
          },
          scope: "extension",
          extensionType: "channel",
          extensionName: "web",
        },
      };
      const t = vi.fn().mockReturnValue("fallback");

      expect(resolveSettingsGroupTitle("web", schemas, t)).toBe("Web Channel");
      expect(t).not.toHaveBeenCalled();
    });

    it("falls back to frontend translation key when schema title is missing", () => {
      const schemas: ISettingSchemasMap = {
        custom_group: {
          schema: {},
          scope: "extension",
        },
      };
      const t = vi.fn().mockReturnValue("Custom Group");

      expect(resolveSettingsGroupTitle("custom_group", schemas, t)).toBe(
        "Custom Group",
      );
      expect(t).toHaveBeenCalledWith("title.custom_group", {
        ns: "custom_group",
        defaultValue: "custom_group",
      });
    });
  });
});
