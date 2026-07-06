/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useEffect } from "react";

import type {
  ExpressionFieldState,
  ExpressionFormContext,
} from "../expression.types";

/**
 * Reports the field's expression state to the form (and clears it on
 * unmount). Pass `skip` when a nested widget owns the reporting instead —
 * reporting `undefined` here would clobber its state.
 */
export const useExpressionFieldStateReport = (
  id: string,
  state: ExpressionFieldState | undefined,
  report?: ExpressionFormContext["reportExpressionFieldState"],
  skip = false,
) => {
  const hasError = state?.hasError ?? false;
  const suppressSchemaErrors = state?.suppressSchemaErrors ?? false;
  const hasState = state !== undefined;

  useEffect(() => {
    if (skip) {
      return;
    }

    report?.(id, hasState ? { hasError, suppressSchemaErrors } : undefined);
  }, [hasError, hasState, id, report, skip, suppressSchemaErrors]);

  useEffect(() => {
    return () => {
      report?.(id, undefined);
    };
  }, [id, report]);
};
