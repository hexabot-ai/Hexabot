/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { useCallback, useEffect, useState } from "react";

import { QueryValue, useAppRouter } from "@/hooks/useAppRouter";

type QueryParamSerializer<T> = {
  parse: (raw: string | string[] | undefined) => T;
  stringify: (val: T) => string | string[] | undefined;
};

function defaultSerializer<T = string>(): QueryParamSerializer<T> {
  return {
    parse: (raw) => {
      if (Array.isArray(raw)) return raw[0] as unknown as T;
      if (typeof raw === "undefined") return "" as unknown as T;

      return raw as unknown as T;
    },
    stringify: (val) => val as unknown as string,
  };
}

export const useUrlQueryParam = <T>(
  key: string,
  defaultValue: T,
  serializer: QueryParamSerializer<T> = defaultSerializer(),
): [T, (val: T) => void] => {
  const router = useAppRouter();
  const [value, setValue] = useState<T>(() => {
    // On initial load, use query or default
    const initial = router.query[key];

    if (initial === undefined) return defaultValue;
    // parse value if needed (e.g., numbers)
    try {
      return serializer.parse(initial) as T;
    } catch {
      return initial as unknown as T;
    }
  });

  // Sync from URL to state on changes (including initial load when ready)
  useEffect(() => {
    if (!router.isReady) return;
    const urlValue = router.query[key];
    let parsedVal: T = defaultValue;

    if (urlValue !== undefined) {
      try {
        parsedVal = serializer.parse(urlValue);
      } catch {
        parsedVal = urlValue as unknown as T;
      }
    } else {
      parsedVal = defaultValue;
    }
    if (parsedVal !== value) {
      setValue(parsedVal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query[key]]);

  // Update URL when state changes
  const updateValue = useCallback(
    (val: T) => {
      setValue(val);
      if (!router.isReady) return;
      const newQuery: Record<string, QueryValue> = Object.fromEntries(
        Object.entries({ ...router.query }).filter(
          ([key]) => !Object.keys(router.params).includes(key),
        ),
      );

      if (
        val === defaultValue ||
        val === undefined ||
        serializer.stringify(val) === ""
      ) {
        delete newQuery[key];
      } else {
        newQuery[key] = serializer.stringify(val);
      }
      router.push({ pathname: router.pathname, query: newQuery });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, key, defaultValue],
  );

  return [value, updateValue];
};
