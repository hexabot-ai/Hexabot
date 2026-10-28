/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Alert, Box, Typography } from "@mui/material";

import { useOperatorMessages } from "../../hooks/useWorkflowRunOperator";
import type { OperatorErrorDescriptor } from "../../operator.utils";

type OperatorErrorAlertProps = {
  error: OperatorErrorDescriptor | null;
};

/**
 * Error kept inside a dialog, with the fields a refused payload failed on.
 */
export const OperatorErrorAlert = ({ error }: OperatorErrorAlertProps) => {
  const { formatError } = useOperatorMessages();

  if (!error) {
    return null;
  }

  return (
    <Alert severity="error" role="alert">
      <Typography variant="body2">{formatError(error)}</Typography>
      {error.issues.length > 0 ? (
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
          {error.issues.map(({ path, message }, index) => (
            <Typography key={`${path}-${index}`} component="li" variant="body2">
              {path ? (
                <Box component="code" sx={{ fontWeight: 600 }}>
                  {path}
                </Box>
              ) : null}
              {path ? ": " : ""}
              {message}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Alert>
  );
};
