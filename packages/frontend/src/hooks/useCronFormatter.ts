/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useCallback } from "react";

import { useTranslate } from "@/hooks/useTranslate";
import { DOW_VALUES, fromCron, pad } from "@/utils/cron.utils";

export function useCronFormatter() {
  const { t } = useTranslate();

  return useCallback(
    (expression: string): string => {
      const { frequency, interval, minute, hour, dayOfWeek, dayOfMonth } =
        fromCron(expression);
      const at = t("label.cron_at");
      const atMinute = t("label.cron_at_minute");
      const on = t("label.cron_on");
      const onDay = t("label.cron_on_day");
      const freqLabel =
        interval > 1
          ? `${t("label.cron_every_interval")} ${interval} ${t(
              `label.cron_${frequency}s`,
            )}`
          : `${t("label.cron_every")} ${t(`label.${frequency}`)}`;
      const time = `${pad(hour)}:${pad(minute)}`;

      switch (frequency) {
        case "second":
        case "minute":
          return freqLabel;
        case "hour":
          return `${freqLabel} ${atMinute} ${pad(minute)}`;
        case "day":
          return `${freqLabel} ${at} ${time}`;
        case "week": {
          const dowLabel = t(`label.${DOW_VALUES[dayOfWeek]}`);

          return `${freqLabel} ${on} ${dowLabel} ${at} ${time}`;
        }
        case "month":
          return `${freqLabel} ${onDay} ${dayOfMonth} ${at} ${time}`;
      }
    },
    [t],
  );
}
