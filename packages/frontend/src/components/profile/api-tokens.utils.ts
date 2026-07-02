/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Action, type ApiTokenScope } from "@hexabot-ai/types";

export type ApiTokenStatus = "active" | "expired" | "revoked";

type TokenTimestamps = {
  expiresAt?: Date | string | null;
  revokedAt?: Date | string | null;
};

/**
 * Fixed column order for the scope matrix. Every model row renders these four
 * actions; the ones the owner cannot grant are shown disabled to keep the
 * columns aligned.
 */
export const API_TOKEN_ACTIONS = [
  Action.CREATE,
  Action.READ,
  Action.UPDATE,
  Action.DELETE,
] as const;

export type ApiTokenScopeGroup = {
  model: string;
  /** Actions the owner is allowed to grant on this model. */
  actions: Action[];
};

export const getScopeKey = (scope: ApiTokenScope) =>
  `${scope.model}:${scope.action}`;

export const scopeKeyOf = (model: string, action: Action) =>
  `${model}:${action}`;

/** Returns a `YYYY-MM-DDTHH:mm` value usable as a `datetime-local` `min`. */
export const toDateTimeLocalValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return local.toISOString().slice(0, 16);
};

export const formatScopeLabel = (scope: ApiTokenScope) =>
  `${scope.model}:${scope.action}`;

/**
 * Groups the flat list of grantable scopes by model, sorted alphabetically by
 * model and with each model's actions ordered as {@link API_TOKEN_ACTIONS}.
 */
export const groupScopesByModel = (
  scopes: ApiTokenScope[],
): ApiTokenScopeGroup[] => {
  const actionsByModel = new Map<string, Set<Action>>();

  for (const scope of scopes) {
    const existing = actionsByModel.get(scope.model);

    if (existing) {
      existing.add(scope.action);
    } else {
      actionsByModel.set(scope.model, new Set([scope.action]));
    }
  }

  return [...actionsByModel.entries()]
    .map(([model, actions]) => ({
      model,
      actions: API_TOKEN_ACTIONS.filter((action) => actions.has(action)),
    }))
    .sort((left, right) => left.model.localeCompare(right.model));
};

const toDate = (date: Date | string) =>
  date instanceof Date ? date : new Date(date);

export const getApiTokenStatus = (
  token: TokenTimestamps,
  now = new Date(),
): ApiTokenStatus => {
  if (token.revokedAt) {
    return "revoked";
  }

  if (token.expiresAt && toDate(token.expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }

  return "active";
};

export const toApiTokenCreatePayload = ({
  name,
  expiresAt,
  scopes,
}: {
  name: string;
  expiresAt?: string;
  scopes: ApiTokenScope[];
}) => ({
  name: name.trim(),
  expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
  scopes,
});

export const toMcpTokenCreatePayload = ({
  name,
  expiresAt,
}: {
  name: string;
  expiresAt?: string;
}) => ({
  name: name.trim(),
  expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
});

export const formatOptionalDate = (
  date: Date | string | null | undefined,
  locale?: string,
) => {
  if (!date) {
    return null;
  }

  const parsedDate = toDate(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toLocaleString(locale);
};
