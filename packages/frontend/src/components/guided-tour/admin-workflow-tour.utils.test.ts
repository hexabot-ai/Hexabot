/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { WorkflowType } from "@hexabot-ai/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAdminWorkflowTourWorkflowPayload,
  formatAdminWorkflowTourTimestamp,
  getAdminWorkflowTourStorageKey,
  getAdminWorkflowTourTransition,
  isAdminWorkflowTourCompleted,
  isAdminWorkflowTourContinuationAllowed,
  isAdminWorkflowTourDashboardRoute,
  isAdminWorkflowTourEligible,
  isAdminWorkflowTourTargetReady,
  isAdminWorkflowTourWorkflowEditorRoute,
  markAdminWorkflowTourCompleted,
  waitForAdminWorkflowTourTarget,
} from "./admin-workflow-tour.utils";

class FakeStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly items = new Map<string, string>();

  getItem(key: string) {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const createRect = (rect: Partial<DOMRect> = {}) =>
  ({
    bottom: 60,
    height: 50,
    left: 10,
    right: 110,
    top: 10,
    width: 100,
    x: 10,
    y: 10,
    toJSON: () => ({}),
    ...rect,
  }) as DOMRect;
const createTarget = (
  rect: DOMRect = createRect(),
  parentElement: Element | null = null,
) =>
  ({
    getBoundingClientRect: () => rect,
    parentElement,
  }) as Element;
const createViewport = (
  style: Partial<CSSStyleDeclaration> = {},
): Pick<Window, "getComputedStyle" | "innerHeight" | "innerWidth"> => ({
  getComputedStyle: () =>
    ({
      display: "block",
      visibility: "visible",
      ...style,
    }) as CSSStyleDeclaration,
  innerHeight: 240,
  innerWidth: 320,
});

describe("admin-workflow-tour.utils", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds user-scoped completion keys and stores completion", () => {
    const storage = new FakeStorage();
    const userId = "user-1";

    expect(getAdminWorkflowTourStorageKey(userId)).toBe(
      "hexabot.admin_workflow_editor_tour.v1.user-1",
    );
    expect(isAdminWorkflowTourCompleted(userId, storage)).toBe(false);
    expect(markAdminWorkflowTourCompleted(userId, storage)).toBe(true);
    expect(isAdminWorkflowTourCompleted(userId, storage)).toBe(true);
  });

  it("does not complete without a user id or storage", () => {
    expect(isAdminWorkflowTourCompleted(undefined, new FakeStorage())).toBe(
      false,
    );
    expect(markAdminWorkflowTourCompleted(undefined, new FakeStorage())).toBe(
      false,
    );
    expect(isAdminWorkflowTourCompleted("user-1", null)).toBe(false);
    expect(markAdminWorkflowTourCompleted("user-1", null)).toBe(false);
  });

  it("requires auth, workflow permissions, quota availability, and no completion", () => {
    const eligible = {
      canCreateWorkflow: true,
      canReadWorkflow: true,
      isAuthenticated: true,
      isCompleted: false,
      userId: "user-1",
      workflowQuotaReached: false,
    };

    expect(isAdminWorkflowTourEligible(eligible)).toBe(true);
    expect(
      isAdminWorkflowTourEligible({ ...eligible, canCreateWorkflow: false }),
    ).toBe(false);
    expect(
      isAdminWorkflowTourEligible({ ...eligible, canReadWorkflow: false }),
    ).toBe(false);
    expect(
      isAdminWorkflowTourEligible({ ...eligible, isAuthenticated: false }),
    ).toBe(false);
    expect(
      isAdminWorkflowTourEligible({ ...eligible, isCompleted: true }),
    ).toBe(false);
    expect(
      isAdminWorkflowTourEligible({ ...eligible, userId: undefined }),
    ).toBe(false);
    expect(
      isAdminWorkflowTourEligible({ ...eligible, workflowQuotaReached: true }),
    ).toBe(false);
  });

  it("allows an already-started tour to continue after workflow quota changes", () => {
    const continuation = {
      canCreateWorkflow: true,
      canReadWorkflow: true,
      hasStarted: true,
      isAuthenticated: true,
      isCompleted: false,
      isStopped: false,
      userId: "user-1",
    };

    expect(isAdminWorkflowTourContinuationAllowed(continuation)).toBe(true);
    expect(
      isAdminWorkflowTourContinuationAllowed({
        ...continuation,
        hasStarted: false,
      }),
    ).toBe(false);
    expect(
      isAdminWorkflowTourContinuationAllowed({
        ...continuation,
        isStopped: true,
      }),
    ).toBe(false);
    expect(
      isAdminWorkflowTourContinuationAllowed({
        ...continuation,
        isCompleted: true,
      }),
    ).toBe(false);
    expect(
      isAdminWorkflowTourContinuationAllowed({
        ...continuation,
        userId: undefined,
      }),
    ).toBe(false);
  });

  it("builds a conversational workflow payload with a stable generated name", () => {
    const now = new Date(2026, 4, 15, 9, 8, 7);

    expect(formatAdminWorkflowTourTimestamp(now)).toBe("20260515-090807");
    expect(
      buildAdminWorkflowTourWorkflowPayload({
        definitionYml: "flow: []",
        now,
        workflowNamePrefix: "First bot",
      }),
    ).toEqual({
      definitionYml: "flow: []",
      description: null,
      name: "First bot - 20260515-090807",
      schedule: null,
      type: WorkflowType.conversational,
    });
  });

  it("recognizes dashboard and workflow editor tour routes", () => {
    expect(isAdminWorkflowTourDashboardRoute("/")).toBe(true);
    expect(isAdminWorkflowTourDashboardRoute("/workflow-editor")).toBe(false);
    expect(isAdminWorkflowTourWorkflowEditorRoute("/workflow-editor")).toBe(
      true,
    );
    expect(
      isAdminWorkflowTourWorkflowEditorRoute("/workflow-editor/workflow-1"),
    ).toBe(true);
    expect(isAdminWorkflowTourWorkflowEditorRoute("/workflow/runs")).toBe(
      false,
    );
  });

  it("maps Joyride callback events to controlled tour transitions", () => {
    expect(
      getAdminWorkflowTourTransition({
        action: "next",
        index: 0,
        size: 6,
        status: "running",
        type: "step:after",
      }),
    ).toEqual({ nextStepIndex: 1 });
    expect(
      getAdminWorkflowTourTransition({
        action: "prev",
        index: 2,
        size: 6,
        status: "running",
        type: "step:after",
      }),
    ).toEqual({ nextStepIndex: 1 });
    expect(
      getAdminWorkflowTourTransition({
        action: "next",
        index: 5,
        size: 6,
        status: "running",
        type: "step:after",
      }),
    ).toEqual({ complete: true });
    expect(
      getAdminWorkflowTourTransition({
        action: "close",
        index: 1,
        size: 6,
        status: "running",
        type: "step:after",
      }),
    ).toEqual({ complete: true });
    expect(
      getAdminWorkflowTourTransition({
        action: "next",
        index: 3,
        size: 6,
        status: "running",
        type: "error:target_not_found",
      }),
    ).toEqual({ retryStepIndex: 3 });
    expect(
      getAdminWorkflowTourTransition({
        action: "update",
        index: 3,
        size: 6,
        status: "running",
        type: "error",
      }),
    ).toEqual({ stop: true });
    expect(
      getAdminWorkflowTourTransition({
        action: "skip",
        index: 2,
        size: 6,
        status: "skipped",
        type: "tour:end",
      }),
    ).toEqual({ complete: true });
    expect(
      getAdminWorkflowTourTransition({
        action: "close",
        index: 5,
        size: 6,
        status: "finished",
        type: "tour:end",
      }),
    ).toEqual({ complete: true });
  });

  it("checks that targets are rendered and horizontally reachable before starting a step", () => {
    const viewport = createViewport();

    expect(isAdminWorkflowTourTargetReady(createTarget(), viewport)).toBe(true);
    expect(
      isAdminWorkflowTourTargetReady(
        createTarget(createRect({ bottom: 420, top: 370 })),
        viewport,
      ),
    ).toBe(true);
    expect(
      isAdminWorkflowTourTargetReady(
        createTarget(createRect({ right: 0 })),
        viewport,
      ),
    ).toBe(false);
    expect(
      isAdminWorkflowTourTargetReady(
        createTarget(createRect({ width: 0 })),
        viewport,
      ),
    ).toBe(false);
    expect(
      isAdminWorkflowTourTargetReady(
        createTarget(),
        createViewport({ visibility: "hidden" }),
      ),
    ).toBe(false);
  });

  it("resolves target waiting when the target appears later", async () => {
    vi.useFakeTimers();

    const target = {} as Element;
    let activeTarget: Element | null = null;
    const promise = waitForAdminWorkflowTourTarget("[data-tour-id='target']", {
      intervalMs: 10,
      queryTarget: () => activeTarget,
      timeoutMs: 100,
    });
    const assertion = expect(promise).resolves.toBe(target);

    await vi.advanceTimersByTimeAsync(20);
    activeTarget = target;
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it("waits until the target is ready and its measured position is stable", async () => {
    vi.useFakeTimers();

    let rect = createRect({ left: 500, right: 600 });
    const target = {
      getBoundingClientRect: () => rect,
    } as Element;
    let activeTarget: Element | null = null;
    let ready = false;
    let resolved = false;
    const promise = waitForAdminWorkflowTourTarget("[data-tour-id='target']", {
      intervalMs: 10,
      isTargetReady: () => ready,
      queryTarget: () => activeTarget,
      requiredStableChecks: 2,
      timeoutMs: 100,
    }).then((value) => {
      resolved = true;

      return value;
    });

    activeTarget = target;
    await vi.advanceTimersByTimeAsync(10);
    expect(resolved).toBe(false);

    ready = true;
    await vi.advanceTimersByTimeAsync(10);
    expect(resolved).toBe(false);

    rect = createRect({ left: 460, right: 560 });
    await vi.advanceTimersByTimeAsync(10);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toBe(target);
  });

  it("scrolls ready targets into view before resolving", async () => {
    vi.useFakeTimers();

    const scrollTargetIntoView = vi.fn();
    const target = createTarget();
    const promise = waitForAdminWorkflowTourTarget("[data-tour-id='target']", {
      intervalMs: 10,
      isTargetReady: () => true,
      queryTarget: () => target,
      requiredStableChecks: 1,
      scrollTargetIntoView,
      timeoutMs: 100,
    });

    await expect(promise).resolves.toBe(target);
    expect(scrollTargetIntoView).toHaveBeenCalledWith(target);
  });

  it("rejects target waiting after the timeout", async () => {
    vi.useFakeTimers();

    const promise = waitForAdminWorkflowTourTarget("[data-tour-id='missing']", {
      intervalMs: 10,
      queryTarget: () => null,
      timeoutMs: 30,
    });
    const assertion = expect(promise).rejects.toThrow(
      "Tour target was not found: [data-tour-id='missing']",
    );

    await vi.advanceTimersByTimeAsync(30);
    await assertion;
  });
});
