/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Stack,
  Typography,
} from "@mui/material";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import type { ReactNode } from "react";

import {
  JsonSchemaForm,
  type ExpressionPolicy,
} from "@/app-components/inputs/JsonSchemaForm";

export type ActionSchemaPanelProps = {
  title: string;
  schema?: unknown;
  formData: Record<string, unknown>;
  onFormDataChange: (data: Record<string, unknown>) => void;
  onVisibleErrorsChange?: (hasVisibleErrors: boolean) => void;
  panelKey: string;
  emptyLabel: string;
  uiSchema?: UiSchema;
  expressionPolicy?: ExpressionPolicy;
  headerAction?: ReactNode;
  validateOnMount?: boolean;
};

export const ActionSchemaPanel = ({
  title,
  schema,
  formData,
  onFormDataChange,
  onVisibleErrorsChange,
  panelKey,
  emptyLabel,
  uiSchema,
  expressionPolicy = "input-default",
  headerAction,
  validateOnMount,
}: ActionSchemaPanelProps) => (
  <Accordion variant="elevation" defaultExpanded>
    <AccordionSummary>
      {headerAction ? (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          width="100%"
          gap={1}
        >
          <Typography variant="subtitle2">{title}</Typography>
          <Box
            component="span"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {headerAction}
          </Box>
        </Stack>
      ) : (
        <Typography variant="subtitle2">{title}</Typography>
      )}
    </AccordionSummary>
    <AccordionDetails>
      {schema ? (
        <JsonSchemaForm
          schema={schema as RJSFSchema}
          formData={formData}
          onFormDataChange={onFormDataChange}
          onVisibleErrorsChange={onVisibleErrorsChange}
          uiSchema={uiSchema}
          idPrefix={`action-${panelKey}`}
          expressionPolicy={expressionPolicy}
          validateOnMount={validateOnMount}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          {emptyLabel}
        </Typography>
      )}
    </AccordionDetails>
  </Accordion>
);
