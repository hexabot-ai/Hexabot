/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Action,
  AttachmentResourceRef,
  type Attachment,
} from "@hexabot-ai/types";
import { Box, FormHelperText, FormLabel } from "@mui/material";
import { ReactNode, forwardRef } from "react";

import { useGet } from "@/hooks/crud/useGet";
import { useHasPermission } from "@/hooks/useHasPermission";
import { EntityType } from "@/services/types";

import { labelTooltipInputLabelSx } from "../inputs/JsonSchemaForm/widgets/shared";

import AttachmentThumbnail from "./AttachmentThumbnail";
import AttachmentUploader from "./AttachmentUploader";

type AttachmentThumbnailProps = {
  label: ReactNode;
  required?: boolean;
  value: string | undefined | null;
  format: "small" | "basic" | "full";
  accept: string;
  enableMediaLibrary?: boolean;
  size?: number;
  onChange?: (id: string | null, mimeType: string | null) => void;
  error?: boolean;
  helperText?: string;
  resourceRef: AttachmentResourceRef;
};

const AttachmentInput = forwardRef<HTMLDivElement, AttachmentThumbnailProps>(
  (
    {
      label,
      required = false,
      value,
      format,
      accept,
      enableMediaLibrary = true,
      size,
      onChange,
      error,
      helperText,
      resourceRef,
    },
    ref,
  ) => {
    const hasPermission = useHasPermission();
    const handleChange = (attachment?: Attachment | null) => {
      onChange && onChange(attachment?.id || null, attachment?.type || null);
    };

    // Ensure load the attachment if not fetched yet
    useGet(
      value || "",
      {
        entity: EntityType.ATTACHMENT,
      },
      {
        enabled: !!value,
      },
    );

    return (
      <Box ref={ref}>
        <FormLabel
          component="label"
          error={error}
          required={required}
          sx={labelTooltipInputLabelSx}
        >
          {label}
        </FormLabel>
        {value ? (
          <AttachmentThumbnail
            onChange={handleChange}
            id={value}
            format={format}
            size={size}
          />
        ) : hasPermission(EntityType.ATTACHMENT, Action.CREATE) ? (
          <AttachmentUploader
            accept={accept}
            enableMediaLibrary={enableMediaLibrary}
            error={error}
            onChange={handleChange}
            resourceRef={resourceRef}
          />
        ) : null}
        {helperText ? (
          <FormHelperText error={error}>{helperText}</FormHelperText>
        ) : null}
      </Box>
    );
  },
);

AttachmentInput.displayName = "AttachmentInput";

export default AttachmentInput;
