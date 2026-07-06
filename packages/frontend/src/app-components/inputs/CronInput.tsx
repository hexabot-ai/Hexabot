/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  FormControl,
  FormHelperText,
  FormLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import { FC, ReactNode, useEffect, useMemo, useState } from "react";

import { useTranslate } from "@/hooks/useTranslate";
import {
  DEFAULT_CRON_STATE,
  DOW_VALUES,
  FREQUENCY_VALUES,
  type CronState,
  type Frequency,
  fromCron,
  getIntervalOptions,
  pad,
  toCron,
} from "@/utils/cron.utils";

export type CronInputProps = {
  value?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  error?: boolean;
  helperText?: React.ReactNode;
  label?: React.ReactNode;
  disabled?: boolean;
  required?: boolean;
};

const MENU_PROPS = { PaperProps: { sx: { maxHeight: 300 } } };
const PLURAL_FREQUENCIES: Partial<Record<Frequency, string>> = {
  second: "cron_seconds",
  minute: "cron_minutes",
  hour: "cron_hours",
};
// Keeps a label and its select on the same line when the row wraps
const Unit: FC<{ children: ReactNode }> = ({ children }) => (
  <Stack direction="row" alignItems="center" gap={1} flexWrap="nowrap">
    {children}
  </Stack>
);

export const CronInput: FC<CronInputProps> = ({
  value = "",
  onChange,
  onBlur,
  error,
  helperText,
  label,
  disabled,
  required,
}) => {
  const { t } = useTranslate();
  const [state, setState] = useState<CronState>(() =>
    value ? fromCron(value) : { ...DEFAULT_CRON_STATE },
  );

  useEffect(() => {
    setState(value ? fromCron(value) : { ...DEFAULT_CRON_STATE });
  }, [value]);

  const update = (patch: Partial<CronState>) => {
    const next = { ...state, ...patch };

    setState(next);
    onChange?.(toCron(next));
  };
  const { frequency, interval, hour, minute, dayOfWeek, dayOfMonth } = state;
  const frequencyOptions = useMemo(
    () =>
      FREQUENCY_VALUES.map((v) => ({
        value: v,
        label: t(
          `label.${
            interval > 1 && PLURAL_FREQUENCIES[v] ? PLURAL_FREQUENCIES[v] : v
          }`,
        ),
      })),
    [t, interval],
  );
  const dowOptions = useMemo(
    () => DOW_VALUES.map((v, i) => ({ value: i, label: t(`label.${v}`) })),
    [t],
  );
  const intervalOptions = useMemo(() => {
    const options = getIntervalOptions(frequency);

    // Keep externally-authored intervals (e.g. */7) selectable
    return options.includes(interval)
      ? options
      : [...options, interval].sort((a, b) => a - b);
  }, [frequency, interval]);
  const handleFrequency = (e: SelectChangeEvent) => {
    const nextFrequency = e.target.value as Frequency;
    const nextOptions = getIntervalOptions(nextFrequency);

    update({
      frequency: nextFrequency,
      interval: nextOptions.includes(interval) ? interval : 1,
    });
  };
  const handleInterval = (e: SelectChangeEvent<number>) => {
    update({ interval: Number(e.target.value) });
  };
  const handleHour = (e: SelectChangeEvent<number>) => {
    update({ hour: Number(e.target.value) });
  };
  const handleMinute = (e: SelectChangeEvent<number>) => {
    update({ minute: Number(e.target.value) });
  };
  const handleDow = (e: SelectChangeEvent<number>) => {
    update({ dayOfWeek: Number(e.target.value) });
  };
  const handleDom = (e: SelectChangeEvent<number>) => {
    update({ dayOfMonth: Number(e.target.value) });
  };
  const showInterval =
    frequency === "second" || frequency === "minute" || frequency === "hour";
  const showTime =
    frequency === "day" || frequency === "week" || frequency === "month";
  const showAtMinute = frequency === "hour";
  const showDow = frequency === "week";
  const showDom = frequency === "month";

  return (
    <FormControl
      component="fieldset"
      error={error}
      disabled={disabled}
      required={required}
      fullWidth
      onBlur={onBlur}
    >
      {label && (
        <FormLabel component="legend" sx={{ mb: 1 }}>
          {label}
        </FormLabel>
      )}

      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
        <Unit>
          <Typography variant="body2">
            {t(interval > 1 ? "label.cron_every_interval" : "label.cron_every")}
          </Typography>

          {showInterval && (
            <Select
              size="small"
              value={interval}
              onChange={handleInterval}
              disabled={disabled}
              inputProps={{ "aria-label": t("label.cron_interval") }}
              MenuProps={MENU_PROPS}
              sx={{ minWidth: 64 }}
            >
              {intervalOptions.map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </Select>
          )}

          <Select
            size="small"
            value={frequency}
            onChange={handleFrequency}
            disabled={disabled}
            inputProps={{ "aria-label": t("label.schedule") }}
            sx={{ minWidth: 100 }}
          >
            {frequencyOptions.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </Unit>

        {showDow && (
          <Unit>
            <Typography variant="body2">{t("label.cron_on")}</Typography>
            <Select
              size="small"
              value={dayOfWeek}
              onChange={handleDow}
              disabled={disabled}
              inputProps={{ "aria-label": t("label.cron_on") }}
              sx={{ minWidth: 110 }}
            >
              {dowOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </Unit>
        )}

        {showDom && (
          <Unit>
            <Typography variant="body2">{t("label.cron_on_day")}</Typography>
            <Select
              size="small"
              value={dayOfMonth}
              onChange={handleDom}
              disabled={disabled}
              inputProps={{ "aria-label": t("label.cron_on_day") }}
              MenuProps={MENU_PROPS}
              sx={{ minWidth: 72 }}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <MenuItem key={d} value={d}>
                  {d}
                </MenuItem>
              ))}
            </Select>
          </Unit>
        )}

        {showAtMinute && (
          <Unit>
            <Typography variant="body2">{t("label.cron_at_minute")}</Typography>
            <Select
              size="small"
              value={minute}
              onChange={handleMinute}
              disabled={disabled}
              inputProps={{ "aria-label": t("label.minute") }}
              MenuProps={MENU_PROPS}
              sx={{ minWidth: 72 }}
            >
              {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                <MenuItem key={m} value={m}>
                  {pad(m)}
                </MenuItem>
              ))}
            </Select>
          </Unit>
        )}

        {showTime && (
          <Unit>
            <Typography variant="body2">{t("label.cron_at")}</Typography>
            <Select
              size="small"
              value={hour}
              onChange={handleHour}
              disabled={disabled}
              inputProps={{ "aria-label": t("label.hour") }}
              MenuProps={MENU_PROPS}
              sx={{ minWidth: 72 }}
            >
              {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                <MenuItem key={h} value={h}>
                  {pad(h)}
                </MenuItem>
              ))}
            </Select>
            <Typography variant="body2">:</Typography>
            <Select
              size="small"
              value={minute}
              onChange={handleMinute}
              disabled={disabled}
              inputProps={{ "aria-label": t("label.minute") }}
              MenuProps={MENU_PROPS}
              sx={{ minWidth: 72 }}
            >
              {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                <MenuItem key={m} value={m}>
                  {pad(m)}
                </MenuItem>
              ))}
            </Select>
          </Unit>
        )}
      </Stack>

      {showDom && dayOfMonth > 28 && (
        <FormHelperText error={false}>
          {t("label.cron_dom_note")}
        </FormHelperText>
      )}

      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
};
