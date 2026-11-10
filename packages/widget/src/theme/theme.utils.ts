/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import chroma from "chroma-js";
import React from "react";

import {
  DeepPartial,
  ThemeMode,
  ThemePalette,
  ThemeResolutionInput,
  ThemeResolvedMode,
  ThemeSemanticTokens,
  ThemeTypography,
  WidgetTheme,
} from "./theme.types";

const DEFAULT_THEME_MODE: ThemeMode = "system";
const DEFAULT_LIGHT_PRIMARY_COLOR = "#0074D9";
const DEFAULT_DARK_PRIMARY_COLOR = "#111827";
const WHITE_TEXT_COLOR = "#FCFCFC";
const DARK_TEXT_COLOR = "#343842";
const MIN_ACCEPTABLE_LIGHT_TEXT_CONTRAST = 3;
const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const COLOR_FUNCTION_PATTERN = /^(rgba?|hsla?)\(/i;
const DEFAULT_TYPOGRAPHY: ThemeTypography = {
  fontFamily:
    '"IBM Plex Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSizeBase: "1rem",
  fontSizeSm: "0.875rem",
  fontSizeLg: "1.125rem",
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  lineHeight: 1.4,
};
const normalizeColorInput = (value: string): string => {
  if (HEX_COLOR_PATTERN.test(value) && !value.startsWith("#")) {
    return `#${value}`;
  }

  return value;
};
const normalizePrimaryColor = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  if (
    !HEX_COLOR_PATTERN.test(normalizedValue) &&
    !COLOR_FUNCTION_PATTERN.test(normalizedValue)
  ) {
    return undefined;
  }

  const normalizedInput = normalizeColorInput(normalizedValue);

  if (chroma.valid(normalizedInput)) {
    return chroma(normalizedInput).hex("rgb").toUpperCase();
  }

  return undefined;
};
const mixHexColors = (
  source: string,
  target: string,
  weight: number,
): string => {
  const clampedWeight = Math.min(1, Math.max(0, weight));

  return chroma
    .mix(source, target, clampedWeight, "rgb")
    .hex("rgb")
    .toUpperCase();
};
const contrastRatio = (first: string, second: string): number => {
  return chroma.contrast(first, second);
};
const getReadableTextColor = (backgroundColor: string): string => {
  const lightTextContrast = contrastRatio(backgroundColor, WHITE_TEXT_COLOR);

  if (lightTextContrast >= MIN_ACCEPTABLE_LIGHT_TEXT_CONTRAST) {
    return WHITE_TEXT_COLOR;
  }

  return DARK_TEXT_COLOR;
};
const toRgbaColor = (value: string, alpha: number): string => {
  const [red, green, blue] = chroma(value)
    .rgb()
    .map((channel: number) => Math.round(channel));

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};
const buildThemePalette = (
  primary: string,
  resolvedMode: ThemeResolvedMode,
): ThemePalette => {
  const primaryHover =
    resolvedMode === "dark"
      ? mixHexColors(primary, WHITE_TEXT_COLOR, 0.14)
      : mixHexColors(primary, "#000000", 0.15);
  const accent =
    resolvedMode === "dark"
      ? mixHexColors(primary, WHITE_TEXT_COLOR, 0.22)
      : mixHexColors(primary, WHITE_TEXT_COLOR, 0.3);

  return {
    primary,
    onPrimary: getReadableTextColor(primary),
    primaryHover,
    accent,
    onAccent: getReadableTextColor(accent),
    success: resolvedMode === "dark" ? "#22C55E" : "#2ECC40",
    warning: resolvedMode === "dark" ? "#F59E0B" : "#F39C12",
    danger: resolvedMode === "dark" ? "#EF4444" : "#FF4136",
    info: resolvedMode === "dark" ? "#38BDF8" : "#3498DB",
  };
};
const LIGHT_THEME_BASE_TOKENS = (
  palette: ThemePalette,
): ThemeSemanticTokens => ({
  surface: {
    root: "#fcfcfc",
    panel: "#FFFFFF",
    header: palette.primary,
    input: "#FFFFFF",
    sentMessage: palette.primary,
    receivedMessage: "#ececed",
    menu: palette.primary,
    overlay: "rgba(148, 149, 150, 0.2)",
    elevated: "#FFFFFF",
    suggestion: "#FFFFFF",
  },
  text: {
    primary: "#263238",
    secondary: "#565867",
    inverse: "#FFFFFF",
    muted: "#8C98A5",
    onPrimary: palette.onPrimary,
    link: palette.primaryHover,
  },
  border: {
    subtle: "#DFE5E8",
    strong: "#B9B9B9",
    interactive: palette.primary,
  },
  state: {
    error: palette.danger,
    success: palette.success,
    warning: palette.warning,
    info: palette.info,
    typing: "#B6B5BA",
    typingActive: "#9E9DA2",
    disabled: "#C8CAD0",
  },
  interactive: {
    launcher: palette.primary,
    launcherIcon: palette.onPrimary,
    badgeBackground: "#FF4646",
    badgeText: "#FFFFFF",
    buttonPrimaryBg: palette.primary,
    buttonPrimaryText: palette.onPrimary,
    buttonPrimaryHover: palette.primaryHover,
    buttonSecondaryBg: "#FFFFFF",
    buttonSecondaryText: palette.primary,
    buttonSecondaryHover: palette.primaryHover,
    icon: "#5D5E6D",
    iconMuted: "#B8C3CA",
    iconStrong: "#23262A",
    focusRing: toRgbaColor(palette.primary, 0.35),
  },
  shadow: {
    widget: "0 0.4375rem 2.5rem 0.125rem rgba(148, 149, 150, 0.1)",
    elevated: "0 0.125rem 0.3125rem rgba(0, 0, 0, 0.2)",
    overlay: "0 0 25rem 15.625rem rgba(148, 149, 150, 0.2)",
  },
});
const DARK_THEME_BASE_TOKENS = (
  palette: ThemePalette,
): ThemeSemanticTokens => ({
  surface: {
    root: "#101418",
    panel: "#141A20",
    header: palette.primary,
    input: "#111820",
    sentMessage: palette.primary,
    receivedMessage: "#232D38",
    menu: "#1B2430",
    overlay: "rgba(0, 0, 0, 0.45)",
    elevated: "#1A222D",
    suggestion: "#1A222D",
  },
  text: {
    primary: "#ECF0F1",
    secondary: "#C6D0DA",
    inverse: "#111827",
    muted: "#94A3B8",
    onPrimary: palette.onPrimary,
    link: palette.accent,
  },
  border: {
    subtle: "#32404F",
    strong: "#46566A",
    interactive: palette.accent,
  },
  state: {
    error: palette.danger,
    success: palette.success,
    warning: palette.warning,
    info: palette.info,
    typing: "#6C7280",
    typingActive: "#9AA5B1",
    disabled: "#64748B",
  },
  interactive: {
    launcher: palette.primary,
    launcherIcon: palette.onPrimary,
    badgeBackground: "#EF4444",
    badgeText: "#FFFFFF",
    buttonPrimaryBg: palette.primary,
    buttonPrimaryText: palette.onPrimary,
    buttonPrimaryHover: palette.accent,
    buttonSecondaryBg: "#1F2937",
    buttonSecondaryText: "#E2E8F0",
    buttonSecondaryHover: "#334155",
    icon: "#CBD5E1",
    iconMuted: "#94A3B8",
    iconStrong: "#F8FAFC",
    focusRing: toRgbaColor(palette.primary, 0.4),
  },
  shadow: {
    widget: "0 0.4375rem 2.5rem 0.125rem rgba(0, 0, 0, 0.45)",
    elevated: "0 0.125rem 0.3125rem rgba(0, 0, 0, 0.5)",
    overlay: "0 0 25rem 15.625rem rgba(0, 0, 0, 0.45)",
  },
});

type CssVariables = React.CSSProperties &
  Record<`--${string}`, string | number>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};
const deepMerge = <T>(base: T, override?: DeepPartial<T>): T => {
  if (!override) {
    return base;
  }

  const result = { ...base } as Record<string, unknown>;

  Object.keys(override).forEach((key) => {
    const overrideValue = override[key as keyof T];

    if (typeof overrideValue === "undefined") {
      return;
    }

    const baseValue = result[key];

    if (isRecord(baseValue) && isRecord(overrideValue)) {
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overrideValue as DeepPartial<Record<string, unknown>>,
      );

      return;
    }

    result[key] = overrideValue as unknown;
  });

  return result as T;
};
const isThemeMode = (mode: unknown): mode is ThemeMode => {
  return mode === "light" || mode === "dark" || mode === "system";
};
const resolveThemeMode = (
  mode: unknown,
  prefersDarkMode: boolean,
): { mode: ThemeMode; resolvedMode: ThemeResolvedMode } => {
  const normalizedMode = isThemeMode(mode) ? mode : DEFAULT_THEME_MODE;
  const resolvedMode =
    normalizedMode === "system"
      ? prefersDarkMode
        ? "dark"
        : "light"
      : normalizedMode;

  return { mode: normalizedMode, resolvedMode };
};
const resolveThemePalette = (
  primaryColor: unknown,
  resolvedMode: ThemeResolvedMode,
): ThemePalette => {
  const fallbackPrimaryColor =
    resolvedMode === "dark"
      ? DEFAULT_DARK_PRIMARY_COLOR
      : DEFAULT_LIGHT_PRIMARY_COLOR;
  const selectedPrimaryColor =
    normalizePrimaryColor(primaryColor) ?? fallbackPrimaryColor;

  return buildThemePalette(selectedPrimaryColor, resolvedMode);
};
const buildBaseTokens = (
  resolvedMode: ThemeResolvedMode,
  palette: ThemePalette,
): ThemeSemanticTokens => {
  return resolvedMode === "dark"
    ? DARK_THEME_BASE_TOKENS(palette)
    : LIGHT_THEME_BASE_TOKENS(palette);
};

export const resolveWidgetTheme = ({
  configMode,
  configTheme,
  primaryColor,
  settingsTheme,
  prefersDarkMode = false,
}: ThemeResolutionInput): WidgetTheme => {
  const modeResult = resolveThemeMode(
    configMode ?? configTheme?.mode ?? settingsTheme?.mode,
    prefersDarkMode,
  );
  const selectedPalette = resolveThemePalette(
    primaryColor,
    modeResult.resolvedMode,
  );
  const baseTokens = buildBaseTokens(modeResult.resolvedMode, selectedPalette);
  const tokens = deepMerge(
    deepMerge(baseTokens, settingsTheme?.tokens),
    configTheme?.tokens,
  );
  const typography = deepMerge(
    deepMerge(DEFAULT_TYPOGRAPHY, settingsTheme?.typography),
    configTheme?.typography,
  );

  return {
    mode: modeResult.mode,
    resolvedMode: modeResult.resolvedMode,
    palette: selectedPalette,
    typography,
    tokens,
  };
};

export const themeToCssVariables = (theme: WidgetTheme): CssVariables => {
  const { tokens, palette, typography } = theme;

  return {
    "--hb-color-surface-root": tokens.surface.root,
    "--hb-color-surface-panel": tokens.surface.panel,
    "--hb-color-surface-header": tokens.surface.header,
    "--hb-color-surface-input": tokens.surface.input,
    "--hb-color-surface-message-sent": tokens.surface.sentMessage,
    "--hb-color-surface-message-received": tokens.surface.receivedMessage,
    "--hb-color-surface-menu": tokens.surface.menu,
    "--hb-color-surface-elevated": tokens.surface.elevated,
    "--hb-color-surface-suggestion": tokens.surface.suggestion,
    "--hb-color-surface-overlay": tokens.surface.overlay,
    "--hb-color-text-primary": tokens.text.primary,
    "--hb-color-text-secondary": tokens.text.secondary,
    "--hb-color-text-inverse": tokens.text.inverse,
    "--hb-color-text-muted": tokens.text.muted,
    "--hb-color-text-on-primary": tokens.text.onPrimary,
    "--hb-color-text-link": tokens.text.link,
    "--hb-color-border-subtle": tokens.border.subtle,
    "--hb-color-border-strong": tokens.border.strong,
    "--hb-color-border-interactive": tokens.border.interactive,
    "--hb-color-state-error": tokens.state.error,
    "--hb-color-state-success": tokens.state.success,
    "--hb-color-state-warning": tokens.state.warning,
    "--hb-color-state-info": tokens.state.info,
    "--hb-color-state-typing": tokens.state.typing,
    "--hb-color-state-typing-active": tokens.state.typingActive,
    "--hb-color-state-disabled": tokens.state.disabled,
    "--hb-color-interactive-launcher": tokens.interactive.launcher,
    "--hb-color-interactive-launcher-icon": tokens.interactive.launcherIcon,
    "--hb-color-interactive-badge-bg": tokens.interactive.badgeBackground,
    "--hb-color-interactive-badge-text": tokens.interactive.badgeText,
    "--hb-color-interactive-button-primary-bg":
      tokens.interactive.buttonPrimaryBg,
    "--hb-color-interactive-button-primary-text":
      tokens.interactive.buttonPrimaryText,
    "--hb-color-interactive-button-primary-hover":
      tokens.interactive.buttonPrimaryHover,
    "--hb-color-interactive-button-secondary-bg":
      tokens.interactive.buttonSecondaryBg,
    "--hb-color-interactive-button-secondary-text":
      tokens.interactive.buttonSecondaryText,
    "--hb-color-interactive-button-secondary-hover":
      tokens.interactive.buttonSecondaryHover,
    "--hb-color-interactive-icon": tokens.interactive.icon,
    "--hb-color-interactive-icon-muted": tokens.interactive.iconMuted,
    "--hb-color-interactive-icon-strong": tokens.interactive.iconStrong,
    "--hb-color-focus-ring": tokens.interactive.focusRing,
    "--hb-color-palette-primary": palette.primary,
    "--hb-color-palette-on-primary": palette.onPrimary,
    "--hb-shadow-widget": tokens.shadow.widget,
    "--hb-shadow-elevated": tokens.shadow.elevated,
    "--hb-shadow-overlay": tokens.shadow.overlay,
    "--hb-font-family": typography.fontFamily,
    "--hb-font-size-base": typography.fontSizeBase,
    "--hb-font-size-sm": typography.fontSizeSm,
    "--hb-font-size-lg": typography.fontSizeLg,
    "--hb-font-weight-regular": String(typography.fontWeightRegular),
    "--hb-font-weight-medium": String(typography.fontWeightMedium),
    "--hb-line-height-base": String(typography.lineHeight),
  };
};
