/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Button, Typography } from "@mui/material";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import { useTranslate } from "@/hooks/useTranslate";

export const BackButton = ({ href }: { href: string }) => {
  const { t } = useTranslate();

  return (
    <Button
      to={href}
      variant="text"
      startIcon={<ArrowLeft size={18} />}
      component={Link}
    >
      <Typography fontWeight={500}>{t("button.back")}</Typography>
    </Button>
  );
};
