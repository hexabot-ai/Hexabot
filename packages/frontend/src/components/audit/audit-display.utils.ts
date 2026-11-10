/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { AuditLog } from "@hexabot-ai/types";
import {
  CheckCircle2,
  CircleHelp,
  type LucideIcon,
  XCircle,
} from "lucide-react";

import type { TTranslationKeys } from "@/i18n/i18n.types";

export type AuditStatusTone = "success" | "error" | "warning";

export type AuditStatusMeta = {
  icon: LucideIcon;
  labelKey: TTranslationKeys;
  tone: AuditStatusTone;
};

const normalizeDisplayLabel = (value?: string | null): string | undefined => {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
};
const AUDIT_STATUS_META: Record<AuditLog["operationStatus"], AuditStatusMeta> =
  {
    SUCCEEDED: {
      icon: CheckCircle2,
      labelKey: "label.audit_status_succeeded",
      tone: "success",
    },
    FAILED: {
      icon: XCircle,
      labelKey: "label.audit_status_failed",
      tone: "error",
    },
    UNSPECIFIED: {
      icon: CircleHelp,
      labelKey: "label.audit_status_unspecified",
      tone: "warning",
    },
  };

export const getAuditStatusMeta = (
  status: AuditLog["operationStatus"],
): AuditStatusMeta =>
  AUDIT_STATUS_META[status] ?? AUDIT_STATUS_META.UNSPECIFIED;

export const formatAuditActor = (auditLog: AuditLog): string => {
  const actorLabel = normalizeDisplayLabel(auditLog.actorLabel);

  if (actorLabel) {
    return actorLabel;
  }

  return (
    normalizeDisplayLabel(auditLog.actorId) ??
    normalizeDisplayLabel(auditLog.actorType) ??
    "system"
  );
};

export const formatAuditResource = (auditLog: AuditLog): string => {
  const resourceLabel = normalizeDisplayLabel(auditLog.resourceLabel);

  if (resourceLabel) {
    return [auditLog.resourceType, resourceLabel].filter(Boolean).join(" ");
  }

  return [auditLog.resourceType, auditLog.resourceId].filter(Boolean).join(" ");
};

export const formatAuditActivity = (auditLog: AuditLog): string =>
  [
    formatAuditActor(auditLog),
    auditLog.operationType,
    formatAuditResource(auditLog),
  ]
    .filter(Boolean)
    .join(" ");

export const normalizeAuditJsonValue = (value: unknown): unknown =>
  value ?? null;
