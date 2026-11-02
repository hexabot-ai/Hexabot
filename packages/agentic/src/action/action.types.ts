/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ZodType } from 'zod';

import type { InferWorkflowBindings } from '../bindings/base-binding';
import { BaseWorkflowContext } from '../context';
import { Settings } from '../dsl.types';

export type RuntimeSettings<S = unknown> = Settings & S;

export type AnyRuntimeBindings = InferWorkflowBindings;

export interface ActionMetadata<I, O, S> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  settingsSchema: ZodType<S>;
  supportedBindings?: readonly string[];
}

export interface ActionExecutionArgs<
  I,
  C extends BaseWorkflowContext = BaseWorkflowContext,
  S = unknown,
  B extends AnyRuntimeBindings = AnyRuntimeBindings,
> {
  input: I;
  context: C;
  settings: RuntimeSettings<S>;
  bindings: B;
  signal: AbortSignal;
}

export interface Action<
  I = unknown,
  O = unknown,
  C extends BaseWorkflowContext = BaseWorkflowContext,
  S = unknown,
  B extends AnyRuntimeBindings = AnyRuntimeBindings,
> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<I>;
  readonly outputSchema: ZodType<O>;
  readonly settingSchema?: ZodType<S>;
  readonly supportedBindings?: readonly string[];

  execute(args: ActionExecutionArgs<I, C, S, B>): Promise<O>;
  parseInput(payload: unknown): I;
  parseOutput(payload: unknown): O;
  parseSettings(payload: unknown): RuntimeSettings<S>;
  run(
    payload: unknown,
    context: C,
    settings?: Partial<RuntimeSettings<S>>,
    bindings?: B,
    signal?: AbortSignal,
  ): Promise<O>;
}

export type Actions = Record<string, Action>;

export type InferActionArgs<A extends Action> = Parameters<A['execute']>[0];

export type InferActionInput<A extends Action> = InferActionArgs<A>['input'];

export type InferActionContext<A extends Action> =
  InferActionArgs<A>['context'];

export type InferActionOutput<A extends Action> = Awaited<
  ReturnType<A['execute']>
>;

export type InferActionSettings<S extends Action> =
  InferActionArgs<S>['settings'];

export type InferActionBindings<S extends Action> =
  InferActionArgs<S>['bindings'];
