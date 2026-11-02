/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { z, ZodType } from 'zod';

import { BaseWorkflowContext } from '../context';
import { BaseSettingsSchema } from '../dsl.types';
import {
  isNonDeterministicWorkflowError,
  isWorkflowResumeRejectedError,
  throwIfAborted,
} from '../errors';
import { assertSnakeCaseName } from '../utils/naming';
import { sleep, withTimeout } from '../utils/timeout';

import {
  Action,
  ActionExecutionArgs,
  ActionMetadata,
  AnyRuntimeBindings,
  RuntimeSettings,
} from './action.types';

const BASE_SETTINGS_KEYS = Object.keys(BaseSettingsSchema.shape);

/**
 * Base implementation that enforces schema-validated input/output.
 */
export abstract class AbstractAction<
  I,
  O,
  C extends BaseWorkflowContext,
  S,
  B extends AnyRuntimeBindings = AnyRuntimeBindings,
> implements Action<I, O, C, S, B>
{
  public readonly name: string;

  public readonly description: string;

  public readonly inputSchema: ZodType<I>;

  public readonly outputSchema: ZodType<O>;

  public readonly settingSchema: ZodType<S>;

  public readonly supportedBindings: readonly string[];

  /**
   * Sets up core metadata and schemas for the action.
   *
   * @param metadata - Describes the action name, description, and schemas.
   */
  protected constructor(metadata: ActionMetadata<I, O, S>) {
    if (metadata.settingsSchema instanceof z.ZodObject) {
      const actionSettingsKeys = Object.keys(metadata.settingsSchema.shape);
      const overlappingKeys = actionSettingsKeys.filter((key) =>
        BASE_SETTINGS_KEYS.includes(key),
      );

      if (overlappingKeys.length > 0) {
        throw new Error(
          `settingsSchema cannot redefine base settings keys: ${overlappingKeys.join(', ')}`,
        );
      }
    }

    assertSnakeCaseName(metadata.name, 'action');
    this.name = metadata.name;
    this.description = metadata.description;
    this.inputSchema = metadata.inputSchema;
    this.outputSchema = metadata.outputSchema;
    this.settingSchema = metadata.settingsSchema;
    this.supportedBindings = metadata.supportedBindings ?? [];
  }

  /**
   * Parses incoming payloads using the input schema.
   *
   * @param payload - Raw input received by the action.
   * @returns Validated input typed as `I`.
   */
  parseInput(payload: unknown): I {
    return this.inputSchema.parse(payload);
  }

  /**
   * Validates and returns the raw action output.
   *
   * @param payload - Raw output produced by {@link execute}.
   * @returns Output typed as `O` after schema validation.
   */
  parseOutput(payload: unknown): O {
    return this.outputSchema.parse(payload);
  }

  /**
   * Executes the action with retry, timeout, and schema safety.
   *
   * @param payload - Raw input being provided to the action.
   * @returns Validated output produced by the action.
   * @throws Error when retries are exhausted or validation fails.
   */
  parseSettings(payload: unknown): RuntimeSettings<S> {
    const settings = z
      .intersection(BaseSettingsSchema, this.settingSchema)
      .parse(payload ?? {});

    return (settings ?? {}) as RuntimeSettings<S>;
  }

  async run(
    payload: unknown,
    context: C,
    settings?: Partial<RuntimeSettings<S>>,
    bindings?: B,
    signal?: AbortSignal,
  ): Promise<O> {
    const input = this.parseInput(payload);
    const parsedSettings = this.parseSettings(settings);
    const parsedBindings = (bindings ?? {}) as B;
    this.assertSupportedBindings(parsedBindings);
    const timeoutMs = parsedSettings.timeout_ms ?? 0;
    const retrySettings = parsedSettings.retries ?? {
      enabled: false,
      max_attempts: 1,
      backoff_ms: 0,
      max_delay_ms: 0,
      jitter: 0,
      multiplier: 1,
    };
    const retriesEnabled = retrySettings.enabled ?? true;
    const maxAttempts = retriesEnabled ? retrySettings.max_attempts : 1;

    let attempt = 0;
    let currentDelay = retrySettings.backoff_ms ?? 0;
    const maxDelayMs = retrySettings.max_delay_ms;
    const jitter = retrySettings.jitter;
    const multiplier = retrySettings.multiplier;
    // Suspend keys are positional within the body, so every attempt has to
    // start from where this run did: otherwise a retry asks for `index:2`
    // where the first attempt resolved `index:1`, and the step suspends on a
    // wait whose payload was already delivered.
    const rewindSuspendCursor = context
      ?.getWorkflowRuntime?.()
      ?.markSuspendCursor?.();

    while (attempt < maxAttempts) {
      if (signal) {
        throwIfAborted(signal);
      }

      rewindSuspendCursor?.();

      try {
        const result = await withTimeout(
          this.execute({
            input,
            context,
            settings: parsedSettings,
            bindings: parsedBindings,
            signal: signal ?? new AbortController().signal,
          }),
          timeoutMs,
          signal,
        );

        return this.parseOutput(result);
      } catch (error) {
        attempt += 1;

        // A retry would read the same refused resume payload again, or replay
        // the same body into the same mismatch with what it recorded.
        if (
          attempt >= maxAttempts ||
          isWorkflowResumeRejectedError(error) ||
          isNonDeterministicWorkflowError(error)
        ) {
          throw error;
        }

        let delay = currentDelay;
        if (maxDelayMs > 0) {
          delay = Math.min(delay, maxDelayMs);
        }

        if (delay > 0) {
          const jitterFactor =
            jitter > 0 ? 1 + (Math.random() * 2 - 1) * jitter : 1;
          const jitteredDelay = Math.max(0, Math.round(delay * jitterFactor));

          if (jitteredDelay > 0) {
            await sleep(jitteredDelay, signal);
          }
        }

        const nextDelay = currentDelay * multiplier;
        currentDelay =
          maxDelayMs > 0 ? Math.min(nextDelay, maxDelayMs) : nextDelay;
      }
    }

    throw new Error('Action failed after exhausting retry attempts.');
  }

  private assertSupportedBindings(bindings: B): void {
    const bindingKinds = Object.keys(
      (bindings ?? {}) as Record<string, unknown>,
    );
    if (bindingKinds.length === 0) {
      return;
    }

    const unsupportedKinds = bindingKinds.filter(
      (bindingKind) => !this.supportedBindings.includes(bindingKind),
    );
    if (unsupportedKinds.length === 0) {
      return;
    }

    const supported =
      this.supportedBindings.length > 0
        ? this.supportedBindings.join(', ')
        : '<none>';
    throw new Error(
      `Action "${this.name}" does not support binding kind(s): ${unsupportedKinds.join(', ')}. Supported binding kinds: ${supported}.`,
    );
  }

  /**
   * Runs the core business logic for the action.
   *
   * @param args - Strongly typed input and context for the action.
   * @returns Action output wrapped in a promise.
   */
  abstract execute(args: ActionExecutionArgs<I, C, S, B>): Promise<O>;
}
