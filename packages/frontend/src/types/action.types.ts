/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { IconName } from "lucide-react/dynamic";
import type { JSONSchema } from "monaco-yaml";

import type { Format } from "@/services/types";

import type { IBaseSchema, IFormat } from "./base.types";

export interface IActionStub extends IBaseSchema {}

export interface IAction extends IActionStub, IFormat<Format.BASIC> {
  name: string;
  title: string;
  icon?: IconName;
  color: string;
  group: string;
  description: string;
  supportedBindings: string[];
  inputSchema: JSONSchema;
  settingSchema: JSONSchema;
  outputSchema: JSONSchema;
}
