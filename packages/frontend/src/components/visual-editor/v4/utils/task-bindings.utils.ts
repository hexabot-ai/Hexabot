/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { DefDefinition } from "@hexabot-ai/agentic";

export const toBindingRefs = (value: unknown, multiple: boolean): string[] => {
  if (multiple) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((entry): entry is string => typeof entry === "string")
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const normalized = value.trim();

    return normalized ? [normalized] : [];
  }

  // Be tolerant with invalid local state and recover to a string list.
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .filter(Boolean);
};

const withDefBindingRefs = <TDefDefinition extends DefDefinition>(
  defDefinition: TDefDefinition,
  bindingKind: string,
  refs: string[],
  multiple: boolean,
): TDefDefinition => {
  const nextBindings: Record<string, string | string[]> = {
    ...(defDefinition.bindings ?? {}),
  };

  if (refs.length > 0) {
    nextBindings[bindingKind] = multiple ? refs : refs[0];
  } else {
    delete nextBindings[bindingKind];
  }

  if (Object.keys(nextBindings).length === 0) {
    const { bindings: _bindings, ...defWithoutBindings } = defDefinition;

    return defWithoutBindings as TDefDefinition;
  }

  return {
    ...defDefinition,
    bindings: nextBindings,
  } as TDefDefinition;
};

export const setDefBindingRefs = <TDefDefinition extends DefDefinition>(
  defDefinition: TDefDefinition,
  bindingKind: string,
  refs: string[],
  multiple: boolean,
): TDefDefinition =>
  withDefBindingRefs(defDefinition, bindingKind, refs, multiple);

export const mountDefBindingRef = <TDefDefinition extends DefDefinition>(
  defDefinition: TDefDefinition,
  bindingKind: string,
  bindingRef: string,
  multiple: boolean,
): TDefDefinition => {
  const currentRefs = toBindingRefs(
    defDefinition.bindings?.[bindingKind],
    multiple,
  );

  if (multiple) {
    if (currentRefs.includes(bindingRef)) {
      return defDefinition;
    }

    return setDefBindingRefs(
      defDefinition,
      bindingKind,
      [...currentRefs, bindingRef],
      true,
    );
  }

  if (currentRefs.length === 1 && currentRefs[0] === bindingRef) {
    return defDefinition;
  }

  return setDefBindingRefs(defDefinition, bindingKind, [bindingRef], false);
};

export const unmountDefBindingRef = <TDefDefinition extends DefDefinition>(
  defDefinition: TDefDefinition,
  bindingKind: string,
  bindingRef: string,
  multiple: boolean,
): TDefDefinition => {
  const currentRefs = toBindingRefs(
    defDefinition.bindings?.[bindingKind],
    multiple,
  );

  if (!currentRefs.includes(bindingRef)) {
    return defDefinition;
  }

  const nextRefs = currentRefs.filter((refName) => refName !== bindingRef);

  return setDefBindingRefs(defDefinition, bindingKind, nextRefs, multiple);
};

// Deprecated aliases kept to avoid broad call-site churn.
export const mountTaskBindingRef = mountDefBindingRef;
export const unmountTaskBindingRef = unmountDefBindingRef;
