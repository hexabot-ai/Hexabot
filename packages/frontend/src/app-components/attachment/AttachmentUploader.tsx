/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { AttachmentResourceRef, type Attachment } from "@hexabot-ai/types";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  styled,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import {
  CloudUpload as CloudUploadIcon,
  FolderOpen as FolderCopyIcon,
} from "lucide-react";
import { ChangeEvent, DragEvent, FC, useId, useState } from "react";

import { useUpload } from "@/hooks/crud/useUpload";
import { useDialogs } from "@/hooks/useDialogs";
import { useToast } from "@/hooks/useToast";
import { useTranslate } from "@/hooks/useTranslate";
import { EntityType } from "@/services/types";

import { AttachmentFormDialog } from "./AttachmentFormDialog";
import AttachmentThumbnail from "./AttachmentThumbnail";

const FileUploadLabel = styled("label")<{
  error?: boolean;
  isDragOver: boolean;
}>(
  ({ error, isDragOver, theme }) => `
  position: relative;
  cursor: pointer;
  text-align: center;
  display: flex;
  width: 100%;
  height: 256px;
  border: 2px dashed ${error ? theme.palette.error.main : theme.palette.grey[400]};
  border-radius: 15px;
  transition: opacity 0.4s ease-in-out;
  &:hover p,
  &:hover svg,
  & img {
    opacity: 1;
    transition: all 0.3s ease-in-out;
  }
  p,
  svg {
    opacity: 0.75;
    transition: all 0.3s ease-in-out;
  }
  img {
    opacity: ${isDragOver ? 0.75 : 1};
    transition: all 0.3s ease-in-out;
  }
`,
);
const HiddenInput = styled("input")`
  display: none;
`;
const IconText = styled(Box)`
  display: flex;
  justify-content: center;
  flex-direction: column;
  align-items: center;
  position: absolute;
`;

export type FileUploadProps = {
  imageButton?: boolean;
  accept: string;
  enableMediaLibrary?: boolean;
  error?: boolean;
  onChange?: (data?: Attachment | null) => void;
  onUploadComplete?: () => void;
  resourceRef: AttachmentResourceRef;
};

const AttachmentUploader: FC<FileUploadProps> = ({
  accept,
  enableMediaLibrary,
  error,
  onChange,
  onUploadComplete,
  resourceRef,
}) => {
  const [attachment, setAttachment] = useState<Attachment | undefined>(
    undefined,
  );
  const uid = useId();
  const { t } = useTranslate();
  const dialogs = useDialogs();
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const { toast } = useToast();
  const { mutate: uploadAttachment, isPending } = useUpload(
    EntityType.ATTACHMENT,
    {
      onError: () => {
        toast.error(t("message.upload_failed"));
      },
      onSuccess: (data) => {
        toast.success(t("message.success_save"));
        setAttachment(data);
        onChange?.(data);
        onUploadComplete?.();
      },
    },
  );
  const stopDefaults = (e: DragEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  const handleUpload = (file: File | null) => {
    if (file) {
      const acceptedTypes = accept.split(",");
      const isValidType = acceptedTypes.some((mimeType) => {
        const [type, subtype] = mimeType.split("/");

        if (!type || !subtype) return false; // Ensure valid MIME type

        return (
          file.type === mimeType ||
          (subtype === "*" && file.type.startsWith(`${type}/`))
        );
      });

      if (!isValidType) {
        toast.error(t("message.invalid_file_type"));

        return;
      }
      uploadAttachment({ file, resourceRef });
    }
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files.item(0);

      handleUpload(file);
    }
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files.item(0);

      handleUpload(file);
    }
  };

  return (
    <Grid>
      <Grid container>
        <Grid size={enableMediaLibrary ? 5 : 12}>
          <HiddenInput
            onChange={handleChange}
            accept={accept}
            id={`file-upload${uid}`}
            type="file"
          />
          <FileUploadLabel
            htmlFor={`file-upload${uid}`}
            error={error}
            isDragOver={isDragOver}
            onMouseEnter={() => setIsDragOver(true)}
            onMouseLeave={() => setIsDragOver(false)}
            onDragEnter={stopDefaults}
            onDragLeave={stopDefaults}
            onDragOver={stopDefaults}
            onDrop={(e) => {
              stopDefaults(e);
              setIsDragOver(false);
              onDrop(e);
            }}
          >
            <Grid
              container
              display="flex"
              justifyContent="center"
              alignItems="center"
              width="100%"
              sx={{ padding: "20px" }}
            >
              {isPending ? (
                <CircularProgress />
              ) : attachment ? (
                <AttachmentThumbnail
                  id={attachment.id}
                  format="full"
                  size={128}
                />
              ) : (
                <IconText height="100%" width="80%">
                  <CloudUploadIcon size={36} />
                  <Typography>
                    {t("label.click_or_dragndrop_to_upload")}
                  </Typography>
                </IconText>
              )}
            </Grid>
          </FileUploadLabel>
        </Grid>
        {enableMediaLibrary ? (
          <>
            <Grid container size={2}>
              <Divider orientation="vertical" flexItem sx={{ margin: "20px" }}>
                {t("label.or")}
              </Divider>
            </Grid>
            <Grid
              size={5}
              display="flex"
              justifyContent="center"
              alignItems="center"
            >
              <Button
                startIcon={<FolderCopyIcon size={18} />}
                variant="contained"
                color="primary"
                onClick={() =>
                  dialogs.open(
                    AttachmentFormDialog,
                    {
                      defaultValues: { accept, onChange },
                    },
                    { maxWidth: "xl", isSingleton: true },
                  )
                }
              >
                {t("button.media_library")}
              </Button>
            </Grid>
          </>
        ) : null}
      </Grid>
    </Grid>
  );
};

AttachmentUploader.displayName = "AttachmentUploader";

export default AttachmentUploader;
