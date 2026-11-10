/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { PropsWithChildren } from "react";
import { createContext, useContext } from "react";

import type { GlobalsSchema, JsonSchemaLike } from "./types";

const createOpenObjectSchema = (): JsonSchemaLike => ({
  type: "object",
  properties: {},
  additionalProperties: true,
});
const DEFAULT_JSONATA_GLOBALS_SCHEMA: GlobalsSchema = {
  type: "object",
  properties: {
    $input: createOpenObjectSchema(),
    $output: createOpenObjectSchema(),
    $context: createOpenObjectSchema(),
  },
};
const JsonataGlobalsSchemaContext = createContext<GlobalsSchema | undefined>(
  undefined,
);

type JsonataGlobalsSchemaProviderProps = PropsWithChildren<{
  globalsSchema: GlobalsSchema;
}>;

export const JsonataGlobalsSchemaProvider = ({
  globalsSchema,
  children,
}: JsonataGlobalsSchemaProviderProps) => (
  <JsonataGlobalsSchemaContext.Provider value={globalsSchema}>
    {children}
  </JsonataGlobalsSchemaContext.Provider>
);

export const useJsonataGlobalsSchema = () =>
  useContext(JsonataGlobalsSchemaContext) ?? DEFAULT_JSONATA_GLOBALS_SCHEMA;
