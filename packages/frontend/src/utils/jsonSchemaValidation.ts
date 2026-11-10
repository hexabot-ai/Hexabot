/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Schema, Validator, ValidatorResult } from "jsonschema";

import { JsonSchemaOptionContext } from "@/app-components/inputs/JsonSchemaObjectBuilder";
import draft07Schema from "@/utils/jsonschema/draft-07.json";
import fieldInput from "@/utils/jsonschema/field-input.json";

const getSchemaValidatorByContext = <
  C extends JsonSchemaOptionContext = "default",
>(
  context?: C,
): { schema: Schema; uri?: string } => {
  if (context === "fieldInput") {
    const fieldInputSchema = fieldInput as any as Schema;

    return {
      schema: fieldInputSchema,
      uri: fieldInputSchema.$id ?? fieldInputSchema.id,
    };
  }

  const draft07 = draft07Schema as any as Schema;
  const draft07Id =
    draft07.$id ?? draft07.id ?? "http://json-schema.org/draft-07/schema#";

  return { schema: draft07, uri: draft07Id };
};

export const validateJsonSchema = <
  C extends JsonSchemaOptionContext = "default",
>(
  instanceSchema: Record<string, any>,
  context?: C,
): ValidatorResult => {
  const { schema, uri } = getSchemaValidatorByContext(context);
  const schemaValidator = new Validator();

  schemaValidator.addSchema(schema, uri);

  return schemaValidator.validate(instanceSchema as Schema, schema);
};
