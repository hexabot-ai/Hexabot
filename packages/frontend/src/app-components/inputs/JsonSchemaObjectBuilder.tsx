/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  type ContentFieldType,
  resolveContentFieldType,
} from "@hexabot-ai/types";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  Plus as AddIcon,
  Trash2 as DeleteIcon,
  Lock as LockIcon,
} from "lucide-react";
import * as React from "react";
import {
  Controller,
  useFieldArray,
  useFormContext,
  useFormState,
  useWatch,
} from "react-hook-form";

import { useTranslate } from "@/hooks/useTranslate";

export type JsonSchemaOptionContext = "default" | "fieldInput";

const BASE_TYPE_OPTIONS = {
  default: [
    { value: "string", label: "string" },
    { value: "number", label: "number" },
    { value: "integer", label: "integer" },
    { value: "boolean", label: "boolean" },
    { value: "object", label: "object" },
    { value: "array", label: "array" },
    { value: "null", label: "null" },
  ],
  fieldInput: [
    { value: "string", label: "Text" },
    { value: "uri", label: "URL" },
    { value: "textarea", label: "Textarea" },
    { value: "boolean", label: "Checkbox" },
    { value: "file", label: "File" },
  ],
} as const satisfies Record<
  JsonSchemaOptionContext,
  { value: string; label: string }[]
> & { fieldInput: { value: ContentFieldType; label: string }[] };
const isPlainObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export type JsonSchemaType<C extends JsonSchemaOptionContext = "default"> =
  (typeof BASE_TYPE_OPTIONS)[C][number]["value"];

type ContextTypeOption<C extends JsonSchemaOptionContext = "default"> = {
  label: string;
  value: JsonSchemaType<C>;
};
const getContextTypeOptions = <C extends JsonSchemaOptionContext = "default">(
  context?: C,
) => {
  return BASE_TYPE_OPTIONS[context || "default"] as ContextTypeOption<C>[];
};

type SchemaNodeBase = {
  title?: string;
  description?: string;
  /**
   * The JSON Schema the node was read from, kept so that the keywords the
   * form does not edit (`default`, `enum`, `format`, ...) are written back
   * (see `JsonSchemaConversionOptions.keepSource`). A node added in the form,
   * or whose type was changed in it, has none.
   */
  source?: Record<string, unknown>;
};

export type SchemaNodeForm =
  | (SchemaNodeBase & {
      type: "object";
      properties: PropertyEntryForm[];
    })
  | (SchemaNodeBase & {
      type: "array";
      items: SchemaNodeForm;
    })
  | (SchemaNodeBase & {
      type: Exclude<JsonSchemaType, "object" | "array">;
    });

export type JsonSchemaConversionOptions = {
  /**
   * Round-trip a schema the form did not write. Reading keeps each node's
   * original schema on the node; writing starts from it, so the keywords the
   * form does not edit survive, a type it read loosely (a union, or none) is
   * left as it was, and an object is only closed to other properties when
   * its schema said so. Without it, the output only holds what the form
   * edits, and every object refuses other properties.
   */
  keepSource?: boolean;
};

/** The keywords the form edits; a kept source says the rest. */
const EDITED_KEYWORDS: readonly string[] = [
  "type",
  "title",
  "description",
  "properties",
  "required",
  "items",
];

/**
 * List the keywords of a node's source the form does not show, for the
 * reader to know they are there.
 */
export const getKeptKeywords = (source: unknown): string[] =>
  isPlainObject(source)
    ? Object.keys(source).filter(
        (keyword) =>
          !EDITED_KEYWORDS.includes(keyword) &&
          keyword !== "$schema" &&
          keyword !== "additionalProperties",
      )
    : [];

export type PropertyEntryForm = {
  key: string;
  required?: boolean;
  schema: SchemaNodeForm;
};

export function makeDefaultSchemaNode(
  type: JsonSchemaType,
  properties: PropertyEntryForm[] = [],
): SchemaNodeForm {
  switch (type) {
    case "object":
      return {
        type: "object",
        properties,
      };
    case "array":
      return {
        type: "array",
        items: makeDefaultSchemaNode("string"),
      };
    default:
      return { type };
  }
}

/** Whether array items are the ones the form gives an array by default. */
const isDefaultItems = (items: SchemaNodeForm | undefined): boolean =>
  !items ||
  (!items.source &&
    items.type === "string" &&
    !items.title?.trim() &&
    !items.description?.trim());
/**
 * Write what the form edited over the schema the node was read from, in the
 * order of that schema.
 */
const mergeIntoSource = (
  node: SchemaNodeForm,
  edited: Record<string, any>,
): Record<string, any> => {
  const source = node.source ?? {};
  // Whether other properties are allowed is the source's to say.
  const { additionalProperties: _strict, ...values } = edited;

  // The form shows one type; the source may hold a union, or none.
  if ("type" in source) {
    values.type = source.type;
  } else {
    delete values.type;
  }

  if (
    node.type === "object" &&
    !("properties" in source) &&
    Object.keys(values.properties ?? {}).length === 0
  ) {
    delete values.properties;
  }

  // Items the form cannot show (a tuple, or none) stay as they were, unless
  // they were edited.
  if (node.type === "array" && !isPlainObject(source.items)) {
    if ("items" in source) {
      values.items = source.items;
    } else if (isDefaultItems(node.items)) {
      delete values.items;
    }
  }

  const merged: Record<string, any> = {};

  for (const [keyword, value] of Object.entries(source)) {
    if (!EDITED_KEYWORDS.includes(keyword)) {
      merged[keyword] = value;
    } else if (keyword in values) {
      merged[keyword] = values[keyword];
    }
  }

  for (const keyword of EDITED_KEYWORDS) {
    if (!(keyword in merged) && keyword in values) {
      merged[keyword] = values[keyword];
    }
  }

  return merged;
};

/**
 * Convert the form-friendly structure into a JSON Schema object.
 * You can wrap the root with {$schema: "..."} if you want in your submit handler.
 */
export function toJsonSchema(
  node: SchemaNodeForm,
  options: JsonSchemaConversionOptions = {},
): Record<string, any> {
  const base: Record<string, any> = { type: node.type };
  const title = (node as any).title?.trim?.();
  const description = (node as any).description?.trim?.();

  if (title) base.title = title;
  if (description) base.description = description;

  if (node.type === "object") {
    const propsObj: Record<string, any> = {};
    const required: string[] = [];

    for (const p of node.properties ?? []) {
      const key = (p.key ?? "").trim();

      if (!key) continue;

      propsObj[key] = toJsonSchema(p.schema, options);
      if (p.required) required.push(key);
    }

    base.properties = propsObj;
    if (required.length) base.required = required;

    // We enforce strict object schemas in the builder output.
    base.additionalProperties = false;
  }

  if (node.type === "array") {
    base.items = toJsonSchema(node.items, options);
  }

  return options.keepSource && node.source ? mergeIntoSource(node, base) : base;
}

const isJsonSchemaType = <C extends JsonSchemaOptionContext = "default">(
  value: unknown,
  options: ContextTypeOption<C>[],
): value is JsonSchemaType =>
  typeof value === "string" && options.some((option) => option.value === value);
const capitalizeFirstLetter = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
const resolveSchemaType = <C extends JsonSchemaOptionContext = "default">(
  schema: Record<string, any>,
  fallbackType: JsonSchemaType,
  context?: C,
): JsonSchemaType => {
  const rawType = schema.type;
  const options = getContextTypeOptions(context);

  if (context === "fieldInput") {
    const fieldType = resolveContentFieldType(schema);

    if (fieldType) return fieldType as JsonSchemaType;
  }

  if (Array.isArray(rawType)) {
    const match = rawType.find((entry) => isJsonSchemaType(entry, options));

    if (match) return match;
  }

  if (isJsonSchemaType(rawType, options)) return rawType;
  if ("properties" in schema || "additionalProperties" in schema)
    return "object";
  if ("items" in schema) return "array";

  return fallbackType;
};

export function fromJsonSchema(
  input: unknown,
  fallbackType: JsonSchemaType = "object",
  context?: JsonSchemaOptionContext,
  options: JsonSchemaConversionOptions = {},
): SchemaNodeForm {
  const schema = isPlainObject(input) ? input : {};
  const type = resolveSchemaType(schema, fallbackType, context);
  const title = typeof schema.title === "string" ? schema.title : undefined;
  const description =
    typeof schema.description === "string" ? schema.description : undefined;
  const source =
    options.keepSource && isPlainObject(input) ? { source: input } : {};

  if (type === "object") {
    const properties = isPlainObject(schema.properties)
      ? schema.properties
      : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const requiredSet = new Set(required);

    return {
      type: "object",
      title,
      description,
      ...source,
      properties: Object.entries(properties).map(([key, value]) => ({
        key,
        required: requiredSet.has(key),
        schema: fromJsonSchema(value, "string", context, options),
      })),
    };
  }

  if (type === "array") {
    return {
      type: "array",
      title,
      description,
      ...source,
      items: isPlainObject(schema.items)
        ? fromJsonSchema(schema.items, "string", context, options)
        : makeDefaultSchemaNode("string"),
    };
  }

  return { type, title, description, ...source };
}

type SchemaNodeEditorProps<C extends JsonSchemaOptionContext = "default"> = {
  /** react-hook-form path to this schema node (e.g. "schema", "schema.items", "schema.properties.0.schema") */
  name: string;
  label?: string | React.JSX.Element;
  /** Optional helper text rendered under the root title. */
  description?: React.ReactNode;
  /** If set, type is enforced and selection is hidden. */
  forcedType?: JsonSchemaType;
  /** Hide title input for the root schema node. */
  hideTitle?: boolean;
  /** Hide description input and divider for the root schema node. */
  hideDescription?: boolean;
  /** Prevent infinite/deep UIs */
  depth?: number;
  maxDepth?: number;
  /** Display schema without allowing edits. */
  readOnly?: boolean;
  context?: C;
};

const ReadOnlyPropertyKeysContext = React.createContext<readonly string[]>([]);

function SchemaNodeEditor<C extends JsonSchemaOptionContext = "default">({
  name,
  label,
  description,
  forcedType,
  depth = 0,
  maxDepth = 6,
  hideTitle = true,
  hideDescription = true,
  readOnly = false,
  context,
}: SchemaNodeEditorProps<C>) {
  const options = getContextTypeOptions(context);
  const { control, getValues, setValue } = useFormContext();
  const { t } = useTranslate();
  const type = useWatch({
    control,
    name: `${name}.type`,
  }) as JsonSchemaType | undefined;
  const keptKeywords = getKeptKeywords(
    useWatch({ control, name: `${name}.source` }),
  );

  // Initialize / enforce shape
  React.useEffect(() => {
    const current = getValues(name) as SchemaNodeForm | undefined;
    const desiredType = forcedType ?? current?.type ?? "object";

    // If missing or malformed, set a full default node
    if (!current || typeof current !== "object" || !("type" in current)) {
      setValue(name, makeDefaultSchemaNode(desiredType), {
        shouldDirty: false,
        shouldTouch: false,
      });

      return;
    }

    // Enforce forced type (and reset structure safely)
    if (forcedType && current.type !== forcedType) {
      const next = makeDefaultSchemaNode(forcedType) as any;

      next.title = (current as any).title;
      next.description = (current as any).description;
      setValue(name, next, {
        shouldDirty: !readOnly,
        shouldTouch: !readOnly,
      });

      return;
    }

    // Patch missing structural fields for object/array
    if (desiredType === "object") {
      const props = getValues(`${name}.properties`);

      if (!Array.isArray(props)) {
        setValue(`${name}.properties`, [], {
          shouldDirty: false,
          shouldTouch: false,
        });
      }
    }

    if (desiredType === "array") {
      const items = getValues(`${name}.items`);

      if (!items || typeof items !== "object" || !("type" in items)) {
        setValue(`${name}.items`, makeDefaultSchemaNode("string"), {
          shouldDirty: false,
          shouldTouch: false,
        });
      }
    }
  }, [forcedType, getValues, name, setValue]);

  const effectiveType = forcedType ?? type ?? "object";
  const showTypeSelect = !forcedType;
  const isRootNode = depth === 0;
  const showTitleInput = !(isRootNode && hideTitle);
  const showDescriptionInput = !(isRootNode && hideDescription);
  const resetNodeToType = (nextType: JsonSchemaType) => {
    if (readOnly) {
      return;
    }

    const prev = (getValues(name) ?? {}) as any;
    const next = makeDefaultSchemaNode(nextType) as any;
    // Keep human fields across type changes

    next.title = prev.title;
    next.description = prev.description;
    setValue(name, next, { shouldDirty: true, shouldTouch: true });
  };
  const canGoDeeper = depth < maxDepth;

  return (
    <Paper variant="spaced">
      <Stack spacing={1.5}>
        {(label || depth === 0) && (
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
          >
            <Typography variant={depth === 0 ? "h6" : "subtitle2"}>
              {label ?? t("label.schema", { defaultValue: "Schema" })}
            </Typography>
            {readOnly && isRootNode && (
              <Chip
                size="small"
                icon={<LockIcon size={14} />}
                label={t("label.read_only", { defaultValue: "Read only" })}
              />
            )}
          </Stack>
        )}

        {isRootNode &&
          description &&
          (typeof description === "string" ? (
            <Typography variant="caption" color="text.secondary">
              {description}
            </Typography>
          ) : (
            description
          ))}

        {/* Type + title */}
        {(showTypeSelect || showTitleInput) && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            {showTypeSelect &&
              (readOnly ? (
                <TextField
                  size="small"
                  label={t("label.type")}
                  value={effectiveType}
                  slotProps={{ input: { readOnly: true } }}
                />
              ) : (
                <Controller
                  control={control}
                  name={`${name}.type`}
                  render={() => (
                    <TextField
                      select
                      size="small"
                      label={t("label.type")}
                      value={effectiveType}
                      onChange={(e) =>
                        resetNodeToType(e.target.value as JsonSchemaType)
                      }
                    >
                      {options.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              ))}

            {showTitleInput && (
              <Controller
                control={control}
                name={`${name}.title`}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    size="small"
                    label={t("label.title")}
                    value={field.value ?? ""}
                    slotProps={{ input: { readOnly } }}
                  />
                )}
              />
            )}
          </Stack>
        )}

        {showDescriptionInput && (
          <>
            <Controller
              control={control}
              name={`${name}.description`}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  size="small"
                  label={t("label.description")}
                  multiline
                  minRows={2}
                  value={field.value ?? ""}
                  slotProps={{ input: { readOnly } }}
                />
              )}
            />
          </>
        )}
        {keptKeywords.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t("message.schema_keywords_kept", {
              0: keptKeywords.join(", "),
              defaultValue:
                "Kept as written: {{0}}. This form does not edit them.",
            })}
          </Typography>
        )}
        {["object", "array"].includes(effectiveType) && canGoDeeper && (
          <Divider />
        )}
        {/* Type-specific */}
        {effectiveType === "object" && canGoDeeper && (
          <ObjectSchemaBody
            name={name}
            depth={depth}
            maxDepth={maxDepth}
            readOnly={readOnly}
            context={context}
          />
        )}

        {effectiveType === "array" && canGoDeeper && (
          <ArraySchemaBody
            name={name}
            depth={depth}
            maxDepth={maxDepth}
            readOnly={readOnly}
            context={context}
          />
        )}

        {!canGoDeeper && ["object", "array"].includes(effectiveType) && (
          <Typography variant="body2" color="text.secondary">
            {t("message.max_depth_reached")}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

function ObjectSchemaBody<C extends JsonSchemaOptionContext = "default">({
  name,
  depth,
  maxDepth,
  readOnly,
  context,
}: {
  name: string;
  depth: number;
  maxDepth: number;
  readOnly: boolean;
  context?: C;
}) {
  const { control, getValues } = useFormContext();
  const { t } = useTranslate();
  const propertiesPath = `${name}.properties` as any;
  const { fields, append, remove } = useFieldArray({
    control,
    name: propertiesPath,
  });
  const [newPropertyIndex, setNewPropertyIndex] = React.useState(-1);
  const addProperty = () => {
    setNewPropertyIndex(fields.length);
    append({
      key: "",
      required: false,
      schema: makeDefaultSchemaNode("string"),
    } satisfies PropertyEntryForm);
  };

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="subtitle1">{t("label.properties")}</Typography>
        {!readOnly && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={addProperty}
            size="small"
          >
            {t("button.add_property")}
          </Button>
        )}
      </Stack>

      {fields.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("message.no_properties_yet")}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {fields.map((f, index) => (
            <PropertyEntryEditor
              key={f.id}
              objectName={name}
              index={index}
              onRemove={() => remove(index)}
              depth={depth}
              maxDepth={maxDepth}
              readOnly={readOnly}
              defaultExpanded={index === newPropertyIndex}
              getAllProperties={() =>
                (getValues(propertiesPath) as PropertyEntryForm[]) ?? []
              }
              context={context}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function PropertyEntryEditor<C extends JsonSchemaOptionContext = "default">({
  objectName,
  index,
  onRemove,
  depth,
  maxDepth,
  readOnly,
  defaultExpanded,
  getAllProperties,
  context,
}: {
  objectName: string;
  index: number;
  onRemove: () => void;
  depth: number;
  maxDepth: number;
  readOnly: boolean;
  defaultExpanded: boolean;
  getAllProperties: () => PropertyEntryForm[];
  context?: C;
}) {
  const { control, getFieldState, getValues, setValue } = useFormContext();
  const { t } = useTranslate();
  const entryPath = `${objectName}.properties.${index}`;
  const propertyFormState = useFormState({ control, name: entryPath });
  const hasError = getFieldState(entryPath, propertyFormState).invalid;
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const { submitCount } = propertyFormState;
  const keyValue = useWatch({
    control,
    name: `${entryPath}.key`,
  }) as string | undefined;
  const titleValue = useWatch({
    control,
    name: `${entryPath}.schema.title`,
  }) as string | undefined;
  const schemaType = useWatch({
    control,
    name: `${entryPath}.schema.type`,
  }) as JsonSchemaType | undefined;
  const readOnlyPropertyKeys = React.useContext(ReadOnlyPropertyKeysContext);
  const readOnlyProperty =
    depth === 0 && readOnlyPropertyKeys.includes(keyValue ?? "");
  const isReadOnly = readOnly || readOnlyProperty;
  const previousKeyRef = React.useRef<string | undefined>(undefined);
  const summaryKey = keyValue?.trim()
    ? keyValue.trim()
    : `(${t("label.unnamed")})`;
  const options = getContextTypeOptions(context);
  const schemaTypeLabel = options.find((o) => o.value === schemaType)?.label;
  const summary = summaryKey + (schemaType ? ` : ${schemaTypeLabel}` : "");

  React.useEffect(() => {
    if (hasError) setExpanded(true);
  }, [hasError, submitCount]);

  React.useEffect(() => {
    if (isReadOnly) {
      return;
    }

    const key = (keyValue ?? "").trim();

    // A property read from a schema keeps the title it was written with,
    // even none: opening the form must not change the schema.
    if (!key || getValues(`${entryPath}.schema.source`)) {
      previousKeyRef.current = keyValue;

      return;
    }

    const autoTitle = capitalizeFirstLetter(key);
    const previousKey = (previousKeyRef.current ?? "").trim();
    const previousAutoTitle = previousKey
      ? capitalizeFirstLetter(previousKey)
      : "";
    const currentTitle = (titleValue ?? "").trim();

    if (
      (!currentTitle || currentTitle === previousAutoTitle) &&
      currentTitle !== autoTitle
    ) {
      setValue(`${entryPath}.schema.title`, autoTitle, {
        shouldDirty: true,
        shouldTouch: false,
      });
    }

    previousKeyRef.current = keyValue;
  }, [entryPath, getValues, isReadOnly, keyValue, setValue, titleValue]);

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, value) => setExpanded(value)}
      sx={{ borderColor: hasError ? "error.main" : undefined }}
    >
      <AccordionSummary>
        <Typography variant="subtitle2" flex={1}>
          {summary}
        </Typography>
        {readOnlyProperty && (
          <Chip
            size="small"
            sx={{ alignSelf: "center" }}
            icon={<LockIcon size={14} />}
            label={t("label.read_only", { defaultValue: "Read only" })}
          />
        )}
      </AccordionSummary>

      <AccordionDetails>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Controller
              control={control}
              name={`${entryPath}.key`}
              rules={{
                required: t("message.property_name_is_required"),
                validate: (value) => {
                  const key = (value ?? "").trim();

                  if (!key) return t("message.property_name_is_required");

                  const all = getAllProperties();
                  const dupes = all.filter(
                    (p) => (p.key ?? "").trim() === key,
                  ).length;

                  if (dupes > 1)
                    return t("message.property_name_must_be_unique");

                  return true;
                },
              }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  fullWidth
                  size="small"
                  label={t("label.property_name")}
                  value={field.value ?? ""}
                  slotProps={{ input: { readOnly: isReadOnly } }}
                  error={Boolean(fieldState.error)}
                  helperText={fieldState.error?.message}
                />
              )}
            />

            {!isReadOnly && (
              <Controller
                control={control}
                name={`${entryPath}.required`}
                render={({ field }) => (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={Boolean(field.value)}
                        onChange={(_, checked) => field.onChange(checked)}
                      />
                    }
                    label={t("label.required")}
                  />
                )}
              />
            )}

            <Box sx={{ flex: 1 }} />

            {!isReadOnly && (
              <IconButton
                onClick={onRemove}
                color="error"
                aria-label={t("button.remove_property")}
              >
                <DeleteIcon />
              </IconButton>
            )}
          </Stack>

          {/* Property schema editor (type/title/description + nested if object/array) */}
          <Box sx={{ pl: 0, borderLeft: 0 }}>
            <SchemaNodeEditor
              name={`${entryPath}.schema`}
              label={t("label.property_schema")}
              depth={depth + 1}
              maxDepth={maxDepth}
              readOnly={isReadOnly}
              context={context}
            />
          </Box>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

function ArraySchemaBody<C extends JsonSchemaOptionContext = "default">({
  name,
  depth,
  maxDepth,
  readOnly,
  context,
}: {
  name: string;
  depth: number;
  maxDepth: number;
  readOnly: boolean;
  context?: C;
}) {
  const { t } = useTranslate();

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle1">{t("label.items")}</Typography>
      <SchemaNodeEditor
        name={`${name}.items`}
        label={t("label.items_schema")}
        depth={depth + 1}
        maxDepth={maxDepth}
        readOnly={readOnly}
        context={context}
      />
    </Stack>
  );
}

/**
 * Main component: builds a JSON Schema for a Record<string, any> (root object).
 * Use it inside a react-hook-form <FormProvider>.
 */
export function JsonSchemaObjectBuilder<
  C extends JsonSchemaOptionContext = "default",
>({
  name,
  label,
  description,
  maxDepth = 6,
  hideTitle = true,
  hideDescription = true,
  readOnly = false,
  readOnlyPropertyKeys,
  context,
}: {
  name: string;
  label?: string | React.JSX.Element;
  description?: React.ReactNode;
  maxDepth?: number;
  hideTitle?: boolean;
  hideDescription?: boolean;
  readOnly?: boolean;
  readOnlyPropertyKeys?: readonly string[];
  context?: C;
}) {
  const { t } = useTranslate();
  const resolvedLabel =
    label ??
    t("label.json_schema_object", { defaultValue: "JSON Schema (Object)" });

  return (
    <ReadOnlyPropertyKeysContext.Provider value={readOnlyPropertyKeys ?? []}>
      <SchemaNodeEditor
        name={name}
        label={resolvedLabel}
        description={description}
        forcedType="object"
        depth={0}
        maxDepth={maxDepth}
        hideTitle={hideTitle}
        hideDescription={hideDescription}
        readOnly={readOnly}
        context={context || "default"}
      />
    </ReadOnlyPropertyKeysContext.Provider>
  );
}
