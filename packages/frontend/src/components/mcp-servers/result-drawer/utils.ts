/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { McpServerTransport } from "@hexabot-ai/types";

import { IMcpServerInfo } from "@/types/mcp-server.types";

const toErrorMessage = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => toErrorMessage(entry))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "object" && value !== null) {
    if ("message" in value) {
      return toErrorMessage((value as { message?: unknown }).message);
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }

  return "";
};

export const extractErrorMessage = (error: unknown) => {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return toErrorMessage((error as { message?: unknown }).message);
  }

  return "";
};

export const formatErrorMessage = (message: string) => {
  return message
    .replace(/\r\n/g, "\n")
    .replace(/\\+r\\+n/g, "\n")
    .replace(/\\+n/g, "\n")
    .replace(/\\+t/g, "\t");
};

export const getConnectionLabel = (
  server: IMcpServerInfo,
  noneLabel: string,
): string => {
  if (server.transport === McpServerTransport.http) {
    return server.url || noneLabel;
  }

  const args = Array.isArray(server.args)
    ? server.args.map((arg) => arg.trim()).filter(Boolean)
    : [];

  return server.command
    ? `${server.command}${args.length ? ` ${args.join(" ")}` : ""}`
    : noneLabel;
};
