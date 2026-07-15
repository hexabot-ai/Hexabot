/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import isToday from "dayjs/plugin/isToday";
import localizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";
import weekday from "dayjs/plugin/weekday";

import { DATE_TIME_FORMAT } from "../constants/date-time.constants";

dayjs.extend(relativeTime);
dayjs.extend(isToday);
dayjs.extend(isSameOrAfter);
dayjs.extend(weekday);
dayjs.extend(localizedFormat);
dayjs.extend(duration);

export const getDateTimeFormatter = (date: Date) => ({
  val: date,
  formatParams: {
    val: DATE_TIME_FORMAT,
  },
});

/**
 * Normalizes and formats a date using the provided locale
 *
 * @param {string} locale - The locale to use for formatting (e.g., 'en-US', 'fr-FR')
 * @param {Date | string} dateField - The date to format, either as Date object or string
 * @param {Intl.DateTimeFormatOptions} options - An object that contains one or more properties that specify comparison options
 * @returns {string | undefined} Formatted date string, or undefined if dateField is undefined
 */
export const normalizeDate = (
  locale: string = "en-US",
  dateField?: Date | string,
  options?: Intl.DateTimeFormatOptions,
) => {
  if (!dateField) return undefined;

  const date = typeof dateField === "string" ? new Date(dateField) : dateField;

  return !isNaN(date.getTime())
    ? date.toLocaleString(locale, options)
    : undefined;
};
/**
 * Formats a date based on time difference and locale.
 * @param date - The date to format
 * @param locale - A valid dayjs locale code (e.g., 'en', 'fr', 'am')
 */
export function formatSmartDate(date: Date, locale: string = "en"): string {
  const now = dayjs();
  const inputDate = dayjs(date).locale(locale);
  const diffInMinutes = now.diff(inputDate, "minute");

  if (diffInMinutes < 1) {
    return inputDate.locale(locale).fromNow(); // "a few seconds ago"
  } else if (diffInMinutes < 60) {
    return inputDate.fromNow(); // e.g. "5 minutes ago"
  } else if (inputDate.isToday()) {
    return inputDate.format("LT"); // e.g. "3:25 PM" or localized version
  } else if (inputDate.isSameOrAfter(dayjs().weekday(0))) {
    return inputDate.format("ddd LT"); // e.g. "Tue 3:25 PM"
  } else {
    return inputDate.format("ll LT"); // e.g. "Jul 21, 2025 3:25 PM"
  }
}

export const formatDurationMs = (
  durationMs?: number | null,
  separator: string = " ",
): string => {
  if (durationMs == null) return "-";

  const diffMs = Math.max(0, durationMs);
  const dur = dayjs.duration(diffMs);
  const h = Math.floor(dur.asHours());
  const m = dur.minutes();
  const s = dur.seconds();

  if (h > 0) {
    return `${h}h${separator}${m}m${separator}${s}s`;
  }

  if (m > 0) {
    return `${m}m${separator}${s}s`;
  }

  return `${s}s`;
};

export const getRemainingTime = (ms: number, locale: string = "en"): string => {
  try {
    return dayjs.duration(ms).locale(locale).humanize(true);
  } catch {
    return "Invalid";
  }
};
