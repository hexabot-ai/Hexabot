/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Box, Typography } from "@mui/material";

import { JsonViewer } from "@/app-components/inputs/JsonViewer";

import { isFlatPrimitiveRecord } from "../../operator.utils";

type WaitDetailsProps = {
  details: Record<string, unknown>;
};

const formatScalar = (value: string | number | boolean | null) =>
  value === null ? "—" : String(value);

/**
 * Data an action attached to its wait to support the admin's decision: a
 * key/value list when it is flat, a JSON viewer otherwise.
 */
export const WaitDetails = ({ details }: WaitDetailsProps) => {
  if (isFlatPrimitiveRecord(details)) {
    return (
      <Box
        component="dl"
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(96px, max-content) 1fr",
          columnGap: 2,
          rowGap: 0.5,
          m: 0,
        }}
      >
        {Object.entries(details).map(([key, value]) => (
          <Box key={key} sx={{ display: "contents" }}>
            <Typography
              component="dt"
              variant="body2"
              color="text.secondary"
              sx={{ wordBreak: "break-word" }}
            >
              {key}
            </Typography>
            <Typography
              component="dd"
              variant="body2"
              fontWeight={500}
              sx={{ m: 0, wordBreak: "break-word", whiteSpace: "pre-wrap" }}
            >
              {formatScalar(value)}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box
      height={200}
      overflow="hidden"
      border={1}
      borderColor="divider"
      borderRadius={1}
    >
      <JsonViewer value={details} />
    </Box>
  );
};
