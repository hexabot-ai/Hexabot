/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Stack,
  Typography,
} from "@mui/material";
import { CircleCheck } from "lucide-react";
import type { ComponentProps } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useTranslate } from "@/hooks/useTranslate";

export interface LicenseActivatedModalProps {
  open: boolean;
  onClose: () => void;
}

const LicenseActivatedModal = ({
  open,
  onClose,
}: LicenseActivatedModalProps) => {
  const { t } = useTranslate();
  const { refetchUser } = useAuth();
  const preventClose: NonNullable<ComponentProps<typeof Dialog>["onClose"]> = (
    _event,
    _reason,
  ) => {
    return;
  };

  return (
    <Dialog
      open={open}
      onClose={preventClose}
      disableEscapeKeyDown
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            overflow: "hidden",
            borderRadius: 3,
          },
        },
      }}
    >
      <DialogContent
        sx={{
          pt: 3,
          background:
            "radial-gradient(circle at top right, rgba(255,183,77,0.2), transparent 44%), radial-gradient(circle at top left, rgba(129,199,132,0.16), transparent 40%)",
        }}
      >
        <Stack spacing={1.75}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                color: "success.main",
                backgroundColor: "rgba(46, 125, 50, 0.12)",
                border: "1px solid rgba(46, 125, 50, 0.35)",
              }}
            >
              <CircleCheck size={24} />
            </Box>

            <Typography
              component="span"
              aria-hidden
              sx={{ fontSize: 24, lineHeight: 1 }}
            >
              🎉
            </Typography>
          </Stack>

          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t("message.license_activated_modal_title")}
          </Typography>

          <Typography variant="body1" color="text.secondary">
            {t("message.license_activated_modal_description")}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {t("message.license_activated_modal_cta_hint")}
          </Typography>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button
          onClick={async () => {
            await refetchUser();
            onClose();
          }}
          variant="contained"
          size="large"
          fullWidth
          sx={{
            borderRadius: 2,
            textTransform: "none",
            fontWeight: 700,
            py: 1.2,
          }}
        >
          {t("button.continue")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LicenseActivatedModal;
