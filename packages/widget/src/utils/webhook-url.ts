/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

export const buildWebhookUrl = ({
  sourceId,
  workflowId,
  query,
}: {
  sourceId: string;
  workflowId?: string;
  query?: URLSearchParams | Record<string, string>;
}) => {
  const resolvedSourceId = sourceId.trim();

  if (!resolvedSourceId) {
    throw new Error("Widget config sourceId is required");
  }

  const searchParams =
    query instanceof URLSearchParams
      ? new URLSearchParams(query)
      : new URLSearchParams(query);

  if (workflowId) {
    searchParams.set("workflow_id", workflowId);
  }

  const queryString = searchParams.toString();

  return `/webhook/${resolvedSourceId}/${queryString ? `?${queryString}` : ""}`;
};

// The API's attachment download route, `<API_ORIGIN>/webhook/<source>/download/<name>`.
const DOWNLOAD_PATH = /\/webhook\/[^/]+\/download\/[^/]+$/;

/**
 * Moves an attachment download link the API built on `API_ORIGIN` to the
 * origin of the widget's `apiUrl`, where its socket, and so its session
 * cookie, live. The download checks that session, so a widget served through
 * a same-origin proxy could not open its own files. Other URLs are returned
 * as is.
 */
export const rebaseDownloadUrl = (url: string, apiUrl: string) => {
  try {
    const link = new URL(url);
    const { origin } = new URL(apiUrl);

    if (!DOWNLOAD_PATH.test(link.pathname) || link.origin === origin) {
      return url;
    }

    return `${origin}${link.pathname}${link.search}${link.hash}`;
  } catch {
    return url;
  }
};

/** The message with its attachment download links rebased on `apiUrl`. */
export const rebaseDownloadUrls = <T extends { data?: unknown }>(
  message: T,
  apiUrl: string,
): T => {
  const data = message.data as
    | { url?: unknown; elements?: { image_url?: unknown }[] }
    | undefined;

  if (!data || typeof data !== "object") {
    return message;
  }

  const rebase = (value: unknown) =>
    typeof value === "string" ? rebaseDownloadUrl(value, apiUrl) : value;

  return {
    ...message,
    data: {
      ...data,
      ...("url" in data ? { url: rebase(data.url) } : {}),
      ...(Array.isArray(data.elements)
        ? {
            elements: data.elements.map((element) =>
              element && "image_url" in element
                ? { ...element, image_url: rebase(element.image_url) }
                : element,
            ),
          }
        : {}),
    },
  };
};
