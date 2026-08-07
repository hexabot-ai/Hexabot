/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowType } from "@hexabot-ai/types";

import { RouterType } from "@/services/types";

export const ADMIN_WORKFLOW_TOUR_STORAGE_PREFIX =
  "hexabot.admin_workflow_editor_tour.v1";

export const ADMIN_WORKFLOW_TOUR_SELECTORS = {
  dashboardCreate: '[data-tour-id="admin-workflow-tour-create"]',
  emptyInsert: '[data-tour-id="admin-workflow-tour-empty-insert"]',
  insertStep: '[data-tour-id="admin-workflow-tour-insert-step"]',
  sendTextAction: '[data-tour-id="admin-workflow-tour-send-text-action"]',
  sendTextActionSpotlight:
    '[data-tour-id="admin-workflow-tour-send-text-action-spotlight"]',
  actionSave: '[data-tour-id="admin-workflow-tour-action-save"]',
  chatWidget: '[data-tour-id="admin-workflow-tour-chat-widget"]',
} as const;

export const ADMIN_WORKFLOW_TOUR_CLICK_THROUGH_SELECTORS: Record<
  number,
  string
> = {
  0: ADMIN_WORKFLOW_TOUR_SELECTORS.dashboardCreate,
  1: ADMIN_WORKFLOW_TOUR_SELECTORS.emptyInsert,
  2: ADMIN_WORKFLOW_TOUR_SELECTORS.insertStep,
  3: ADMIN_WORKFLOW_TOUR_SELECTORS.sendTextAction,
  4: ADMIN_WORKFLOW_TOUR_SELECTORS.actionSave,
};

type TourStorage = Pick<Storage, "getItem" | "setItem">;

type AdminWorkflowTourEligibility = {
  canCreateWorkflow: boolean;
  canReadWorkflow: boolean;
  isAuthenticated: boolean;
  isCompleted: boolean;
  userId?: string;
  workflowQuotaReached: boolean;
};

type AdminWorkflowTourContinuation = Omit<
  AdminWorkflowTourEligibility,
  "workflowQuotaReached"
> & {
  hasStarted: boolean;
  isStopped: boolean;
};

type AdminWorkflowTourWorkflowPayloadOptions = {
  definitionYml: string;
  now?: Date;
  workflowNamePrefix?: string;
};

type AdminWorkflowTourCallbackEvent = {
  action: string;
  index: number;
  size: number;
  status: string;
  type: string;
};

export type AdminWorkflowTourTransition = {
  complete?: boolean;
  nextStepIndex?: number;
  retryStepIndex?: number;
  stop?: boolean;
};

type WaitForTargetOptions = {
  intervalMs?: number;
  isTargetReady?: (target: Element) => boolean;
  queryTarget?: (selector: string) => Element | null;
  requiredStableChecks?: number;
  scrollTargetIntoView?: (target: Element) => void;
  timeoutMs?: number;
};

type TourTargetViewport = Pick<
  Window,
  "getComputedStyle" | "innerHeight" | "innerWidth"
>;

const ADMIN_WORKFLOW_TOUR_SPOTLIGHT_PROXY_ATTR =
  "data-admin-workflow-tour-spotlight-proxy";
const ADMIN_WORKFLOW_TOUR_SPOTLIGHT_SOURCES: Record<string, string> = {
  [ADMIN_WORKFLOW_TOUR_SELECTORS.sendTextActionSpotlight]:
    ADMIN_WORKFLOW_TOUR_SELECTORS.sendTextAction,
};
const padDatePart = (value: number) => String(value).padStart(2, "0");
const getAdminWorkflowTourViewport = (): TourTargetViewport | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window;
};
const getAdminWorkflowTourTargetRectSnapshot = (target: Element) => {
  const getBoundingClientRect = target.getBoundingClientRect;

  if (typeof getBoundingClientRect !== "function") {
    return null;
  }

  const rect = getBoundingClientRect.call(target);

  return [rect.top, rect.right, rect.bottom, rect.left, rect.width, rect.height]
    .map((value) => Math.round(value))
    .join(":");
};
const getAdminWorkflowTourSpotlightSourceSelector = (selector: string) =>
  ADMIN_WORKFLOW_TOUR_SPOTLIGHT_SOURCES[selector] ?? selector;
const updateAdminWorkflowTourSpotlightProxy = (
  selector: string,
  sourceTarget: Element,
) => {
  if (
    !ADMIN_WORKFLOW_TOUR_SPOTLIGHT_SOURCES[selector] ||
    typeof document === "undefined"
  ) {
    return;
  }

  const proxy =
    document.querySelector<HTMLElement>(selector) ??
    document.createElement("div");
  const rect = sourceTarget.getBoundingClientRect();

  if (!proxy.parentElement) {
    proxy.setAttribute(
      "data-tour-id",
      "admin-workflow-tour-send-text-action-spotlight",
    );
    proxy.setAttribute(ADMIN_WORKFLOW_TOUR_SPOTLIGHT_PROXY_ATTR, "true");
    proxy.setAttribute("aria-hidden", "true");
    document.body.appendChild(proxy);
  }

  Object.assign(proxy.style, {
    height: `${Math.round(rect.height)}px`,
    left: `${Math.round(rect.left)}px`,
    opacity: "0",
    pointerEvents: "none",
    position: "fixed",
    top: `${Math.round(rect.top)}px`,
    width: `${Math.round(rect.width)}px`,
  });
};
const scrollAdminWorkflowTourTargetIntoView = (target: Element) => {
  const viewport = getAdminWorkflowTourViewport();

  if (!viewport || typeof target.scrollIntoView !== "function") {
    return;
  }

  const rect = target.getBoundingClientRect();

  if (rect.top >= 0 && rect.bottom <= viewport.innerHeight) {
    return;
  }

  target.scrollIntoView({
    block: "center",
    inline: "nearest",
  });
};

export const removeAdminWorkflowTourSpotlightProxy = () => {
  if (typeof document === "undefined") {
    return;
  }

  document
    .querySelectorAll(`[${ADMIN_WORKFLOW_TOUR_SPOTLIGHT_PROXY_ATTR}="true"]`)
    .forEach((proxy) => proxy.remove());
};

export const isAdminWorkflowTourTargetReady = (
  target: Element,
  viewport: TourTargetViewport | null = getAdminWorkflowTourViewport(),
) => {
  if (!viewport) {
    return true;
  }

  const rect = target.getBoundingClientRect();

  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.right <= 0 ||
    rect.left >= viewport.innerWidth
  ) {
    return false;
  }

  let currentTarget: Element | null = target;

  while (currentTarget) {
    const { display, visibility } = viewport.getComputedStyle(currentTarget);

    if (display === "none" || visibility === "hidden") {
      return false;
    }

    currentTarget = currentTarget.parentElement;
  }

  return true;
};

export const getAdminWorkflowTourStorageKey = (userId: string) =>
  `${ADMIN_WORKFLOW_TOUR_STORAGE_PREFIX}.${userId}`;

export const getAdminWorkflowTourStorage = (): TourStorage | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const isAdminWorkflowTourCompleted = (
  userId: string | undefined,
  storage: TourStorage | null = getAdminWorkflowTourStorage(),
) => {
  if (!userId || !storage) {
    return false;
  }

  try {
    return storage.getItem(getAdminWorkflowTourStorageKey(userId)) === "done";
  } catch {
    return false;
  }
};

export const markAdminWorkflowTourCompleted = (
  userId: string | undefined,
  storage: TourStorage | null = getAdminWorkflowTourStorage(),
) => {
  if (!userId || !storage) {
    return false;
  }

  try {
    storage.setItem(getAdminWorkflowTourStorageKey(userId), "done");

    return true;
  } catch {
    return false;
  }
};

export const isAdminWorkflowTourEligible = ({
  canCreateWorkflow,
  canReadWorkflow,
  isAuthenticated,
  isCompleted,
  userId,
  workflowQuotaReached,
}: AdminWorkflowTourEligibility) =>
  Boolean(
    isAuthenticated &&
      userId &&
      canReadWorkflow &&
      canCreateWorkflow &&
      !workflowQuotaReached &&
      !isCompleted,
  );

export const isAdminWorkflowTourContinuationAllowed = ({
  canCreateWorkflow,
  canReadWorkflow,
  hasStarted,
  isAuthenticated,
  isCompleted,
  isStopped,
  userId,
}: AdminWorkflowTourContinuation) =>
  Boolean(
    hasStarted &&
      !isStopped &&
      !isCompleted &&
      isAuthenticated &&
      userId &&
      canReadWorkflow &&
      canCreateWorkflow,
  );

export const isAdminWorkflowTourDashboardRoute = (pathname: string) =>
  pathname === RouterType.HOME;

export const isAdminWorkflowTourWorkflowEditorRoute = (pathname: string) =>
  pathname.startsWith(`/${RouterType.WORKFLOW_EDITOR}`);

export const formatAdminWorkflowTourTimestamp = (date: Date) => {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());
  const second = padDatePart(date.getSeconds());

  return `${year}${month}${day}-${hour}${minute}${second}`;
};

export const buildAdminWorkflowTourWorkflowPayload = ({
  definitionYml,
  now = new Date(),
  workflowNamePrefix = "My first workflow",
}: AdminWorkflowTourWorkflowPayloadOptions) => ({
  definitionYml,
  description: null,
  name: `${workflowNamePrefix} - ${formatAdminWorkflowTourTimestamp(now)}`,
  schedule: null,
  type: WorkflowType.conversational,
});

export const getAdminWorkflowTourTransition = ({
  action,
  index,
  size,
  status,
  type,
}: AdminWorkflowTourCallbackEvent): AdminWorkflowTourTransition => {
  if (status === "finished" || status === "skipped") {
    return { complete: true };
  }

  // Joyride v3 reports failures through the `error` event rather than a status.
  if (type === "error") {
    return { stop: true };
  }

  if (type === "error:target_not_found") {
    return { retryStepIndex: index };
  }

  if (type !== "step:after") {
    return {};
  }

  if (action === "close") {
    return { complete: true };
  }

  const nextStepIndex = action === "prev" ? index - 1 : index + 1;

  if (nextStepIndex >= size) {
    return { complete: true };
  }

  return { nextStepIndex: Math.max(0, nextStepIndex) };
};

export const waitForAdminWorkflowTourTarget = (
  selector: string,
  {
    intervalMs = 100,
    isTargetReady = isAdminWorkflowTourTargetReady,
    queryTarget = (targetSelector) =>
      typeof document === "undefined"
        ? null
        : document.querySelector(targetSelector),
    requiredStableChecks = 2,
    scrollTargetIntoView = scrollAdminWorkflowTourTargetIntoView,
    timeoutMs = 12000,
  }: WaitForTargetOptions = {},
) =>
  new Promise<Element>((resolve, reject) => {
    const startedAt = Date.now();
    let lastRectSnapshot: string | null = null;
    let settled = false;
    let stableChecks = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const clearTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const checkTarget = () => {
      const sourceSelector =
        getAdminWorkflowTourSpotlightSourceSelector(selector);
      const sourceTarget = queryTarget(sourceSelector);

      if (sourceTarget && isTargetReady(sourceTarget)) {
        scrollTargetIntoView(sourceTarget);
        updateAdminWorkflowTourSpotlightProxy(selector, sourceTarget);
      }

      const target =
        sourceSelector === selector ? sourceTarget : queryTarget(selector);

      if (target && isTargetReady(target)) {
        const rectSnapshot = getAdminWorkflowTourTargetRectSnapshot(target);

        if (
          rectSnapshot &&
          requiredStableChecks > 1 &&
          lastRectSnapshot !== rectSnapshot
        ) {
          lastRectSnapshot = rectSnapshot;
          stableChecks = 1;

          return;
        }

        stableChecks += 1;

        if (rectSnapshot && stableChecks < requiredStableChecks) {
          return;
        }

        settled = true;
        clearTimer();
        resolve(target);

        return;
      }

      lastRectSnapshot = null;
      stableChecks = 0;

      if (Date.now() - startedAt >= timeoutMs) {
        settled = true;
        clearTimer();
        reject(new Error(`Tour target was not found: ${selector}`));
      }
    };

    checkTarget();

    if (!settled) {
      timer = setInterval(checkTarget, intervalMs);
    }
  });
