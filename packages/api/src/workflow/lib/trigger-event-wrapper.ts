/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  ScheduledWorkflowInput,
  User,
  UserProfileStub,
} from '@hexabot-ai/types';

import { WorkflowType } from '../types';

export abstract class TriggerEventWrapper<
  U extends UserProfileStub = UserProfileStub,
> {
  abstract readonly triggerType: WorkflowType;

  protected initiator: U;

  private workflowId?: string;

  private threadId?: string;

  /**
   * Returns the user/profile that initiated this event (subscriber or admin).
   */
  getInitiator(): U {
    return this.initiator;
  }

  /**
   * Sets the user/profile that initiated this event (subscriber or admin).
   */
  setInitiator(profile: U) {
    this.initiator = profile;
  }

  /**
   * Sets an optional workflow id used to target execution.
   * This value is transient and not automatically persisted in context/input.
   */
  setWorkflowId(workflowId?: string) {
    this.workflowId = workflowId;
  }

  /**
   * Returns the optional targeted workflow id for this event.
   */
  getWorkflowId(): string | undefined {
    return this.workflowId;
  }

  /**
   * Sets an optional thread id used to scope conversation continuity.
   */
  setThreadId(threadId?: string) {
    this.threadId = threadId;
  }

  /**
   * Returns the optional thread id attached to this event.
   */
  getThreadId(): string | undefined {
    return this.threadId;
  }

  abstract getMetadata(): Record<string, unknown>;

  /**
   * Returns event-scoped data that should live on workflow context state.
   */
  abstract getContextData(): Record<string, unknown>;

  abstract buildInput(): Record<string, unknown>;
}

export class ScheduledEventWrapper extends TriggerEventWrapper<User> {
  readonly triggerType = WorkflowType.scheduled;

  constructor(
    private readonly payload: {
      schedule?: string | null;
      triggeredAt?: Date | string;
    } = {},
  ) {
    super();
  }

  /**
   * Normalize the trigger timestamp to an ISO-8601 string.
   */
  private normalizeTriggeredAt(): string | null {
    const { triggeredAt } = this.payload;

    if (!triggeredAt) {
      return null;
    }

    return triggeredAt instanceof Date
      ? triggeredAt.toISOString()
      : triggeredAt;
  }

  buildInput(): ScheduledWorkflowInput {
    return {
      schedule: this.payload.schedule ?? null,
      triggered_at: this.normalizeTriggeredAt(),
    };
  }

  getMetadata(): Record<string, unknown> {
    return {
      trigger: this.triggerType,
      schedule: this.payload.schedule ?? null,
      triggered_at: this.payload.triggeredAt ?? null,
    };
  }

  getContextData(): Record<string, unknown> {
    return {
      schedule: this.payload.schedule ?? null,
      triggered_at: this.payload.triggeredAt ?? null,
    };
  }
}

export class ManualEventWrapper extends TriggerEventWrapper<User> {
  readonly triggerType = WorkflowType.manual;

  constructor(
    private readonly input: Record<string, unknown> = {},
    private readonly initiatedBy?: string | null,
  ) {
    super();
  }

  buildInput(): Record<string, unknown> {
    return { ...this.input };
  }

  getMetadata(): Record<string, unknown> {
    return {
      trigger: this.triggerType,
      initiated_by: this.initiatedBy ?? null,
    };
  }

  getContextData(): Record<string, unknown> {
    return {
      initiated_by: this.initiatedBy ?? null,
    };
  }
}
