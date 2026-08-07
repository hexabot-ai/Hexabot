/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { Setting } from "@hexabot-ai/types";
import { createContext, type ReactElement, ReactNode } from "react";

import { Progress } from "@/app-components/displays/Progress";
import { useFind } from "@/hooks/crud/useFind";
import { useAuth } from "@/hooks/useAuth";
import { EntityType } from "@/services/types";

export const SettingsContext = createContext<{
  settings: { [key: string]: Setting[] } | undefined;
}>({ settings: undefined });

SettingsContext.displayName = "SettingsContext";

interface SettingsProviderProps {
  children: ReactNode;
}

export const useLoadSettings = () => {
  const { isAuthenticated } = useAuth();
  const { data: settings, ...rest } = useFind(
    { entity: EntityType.SETTING },
    {
      hasCount: false,
    },
    {
      enabled: isAuthenticated,
    },
  );

  return {
    ...rest,
    data:
      settings?.reduce((acc, curr) => {
        const group = acc[curr.group] || [];

        group.push(curr);
        acc[curr.group] = group;

        return acc;
      }, {}) || {},
  };
};

export const SettingsProvider = ({
  children,
}: SettingsProviderProps): ReactElement => {
  const { data, isLoading } = useLoadSettings();

  if (isLoading) return <Progress />;

  return (
    <SettingsContext.Provider
      value={{
        settings: data,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};
