/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type {
  DefDefinitions,
  JsonValue,
  TaskDefinition,
  TaskDefinitions,
} from '@hexabot-ai/agentic';
import { extractTaskDefinitions as extractTaskDefinitionsFromDefs } from '@hexabot-ai/agentic';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import jsonata from 'jsonata';
import { FindManyOptions, In, Not } from 'typeorm';
import { DeleteResult } from 'typeorm/driver/mongodb/typings';

import { I18nService } from '@/i18n/services/i18n.service';
import { BaseOrmService } from '@/utils/generics/base-orm.service';
import { WorkflowService } from '@/workflow/services/workflow.service';

import { TranslationOrmEntity } from '../entities/translation.entity';
import { TranslationRepository } from '../repositories/translation.repository';

@Injectable()
export class TranslationService extends BaseOrmService<TranslationOrmEntity> {
  /** Number of in-flight batch operations deferring the i18n refresh. */
  private i18nRefreshDeferrals = 0;

  constructor(
    repository: TranslationRepository,
    private readonly workflowService: WorkflowService,
    private readonly i18n: I18nService,
  ) {
    super(repository);
    this.resetI18nTranslations();
  }

  public async resetI18nTranslations() {
    const translations = await this.findAll();
    this.i18n.refreshDynamicTranslations(translations);
  }

  /**
   * Synchronize stored translations with the strings currently used by
   * workflows: create missing ones and purge those no longer referenced.
   *
   * Writes run sequentially with the per-event i18n refresh deferred to a
   * single reload at the end, so a large refresh cannot exhaust the DB pool.
   *
   * @param defaultTranslations - Empty translations map seeded on new strings.
   * @returns The result of purging stale translations.
   */
  async refreshWorkflowTranslations(
    defaultTranslations: TranslationOrmEntity['translations'],
  ): Promise<DeleteResult> {
    return await this.deferI18nRefresh(async () => {
      const strings = [
        ...new Set((await this.getAllWorkflowStrings()).filter(Boolean)),
      ];

      for (const str of strings) {
        await this.findOneOrCreate(
          { where: { str } },
          { str, translations: { ...defaultTranslations } },
        );
      }

      const deleteOptions: FindManyOptions<TranslationOrmEntity> =
        strings.length > 0 ? { where: { str: Not(In(strings)) } } : {};

      return await this.deleteMany(deleteOptions);
    });
  }

  /**
   * Return workflow strings marked for translation via $t() inside task
   * JSONata expressions.
   *
   * @returns A promise of all strings available in a array
   */
  async getAllWorkflowStrings(): Promise<string[]> {
    const workflows = await this.workflowService.findAndPopulate({});
    const allStrings: string[] = [];

    for (const workflow of workflows) {
      if (!workflow.definition?.defs) {
        continue;
      }

      try {
        const taskDefinitions = this.extractTaskDefinitions(
          workflow.definition.defs,
        );
        allStrings.push(...this.collectTaskTranslationStrings(taskDefinitions));
      } catch (err) {
        this.logger.warn(
          `Unable to collect workflow translations from ${workflow.id}`,
          err,
        );
      }
    }

    return allStrings;
  }

  /**
   * Updates the in-memory translations
   */
  @OnEvent('hook:translation:*')
  async handleTranslationsUpdate(): Promise<void> {
    if (this.i18nRefreshDeferrals > 0) {
      return;
    }

    await this.resetI18nTranslations();
  }

  /**
   * Run a batch of translation writes with the event-driven i18n refresh
   * deferred, then reload the in-memory translations once at the end.
   */
  private async deferI18nRefresh<T>(operation: () => Promise<T>): Promise<T> {
    this.i18nRefreshDeferrals++;

    try {
      return await operation();
    } finally {
      this.i18nRefreshDeferrals--;
      if (this.i18nRefreshDeferrals === 0) {
        await this.resetI18nTranslations();
      }
    }
  }

  /**
   * Recursively traverse workflow tasks and collect strings passed to $t() in
   * JSONata expressions.
   */
  private collectTaskTranslationStrings(tasks: TaskDefinitions): string[] {
    if (tasks == null || typeof tasks !== 'object') {
      return [];
    }

    return Object.values(tasks).flatMap((task) =>
      this.collectTaskDefinitionTranslations(task),
    );
  }

  private extractTaskDefinitions(defs: DefDefinitions): TaskDefinitions {
    return extractTaskDefinitionsFromDefs(defs);
  }

  /**
   * Collect translation strings only from the task sections that can hold
   * user-facing expressions.
   */
  private collectTaskDefinitionTranslations(task: TaskDefinition): string[] {
    const translatableSections: Array<JsonValue | undefined> = [
      task.inputs as JsonValue | undefined,
      task.settings as JsonValue | undefined,
    ];

    return translatableSections.flatMap((section) =>
      this.collectTranslationsFromValue(section),
    );
  }

  private collectTranslationsFromValue(node: JsonValue | undefined): string[] {
    if (node == null) {
      return [];
    }

    if (typeof node === 'string') {
      return this.extractTranslationsFromExpression(node);
    }

    if (Array.isArray(node)) {
      return node.flatMap((value) => this.collectTranslationsFromValue(value));
    }

    if (typeof node === 'object') {
      return Object.values(node as Record<string, JsonValue>).flatMap((value) =>
        this.collectTranslationsFromValue(value),
      );
    }

    return [];
  }

  /**
   * Extract translation keys from a JSONata expression string.
   */
  private extractTranslationsFromExpression(expression: string): string[] {
    const trimmed = expression.trim();

    if (!trimmed.startsWith('=')) {
      return [];
    }

    try {
      const ast = jsonata(trimmed.slice(1)).ast();

      return this.collectTranslationsFromAst(ast);
    } catch (err) {
      this.logger.warn('Unable to parse JSONata expression for translations', {
        expression: trimmed,
        error: err instanceof Error ? err.message : String(err),
      });

      return [];
    }
  }

  /**
   * Walk JSONata AST to collect translation keys.
   */
  private collectTranslationsFromAst(
    node: unknown,
    seen: Set<unknown> = new Set(),
  ): string[] {
    if (node == null || typeof node !== 'object') {
      return [];
    }

    if (seen.has(node)) {
      return [];
    }
    seen.add(node);

    const current: string[] = [];
    const typedNode = node as Record<string, unknown>;

    if (this.isTranslateCall(typedNode)) {
      const args = (typedNode.arguments as unknown[]) ?? [];
      current.push(
        ...args.flatMap((arg) => {
          if (
            arg &&
            typeof arg === 'object' &&
            (arg as any).type === 'string'
          ) {
            const value = (arg as any).value as string;
            const cleaned = value?.trim();

            return cleaned ? [cleaned] : [];
          }

          return [];
        }),
      );
    }

    Object.values(typedNode).forEach((value) => {
      if (typeof value === 'object' && value !== null) {
        current.push(...this.collectTranslationsFromAst(value, seen));
      }
    });

    return current;
  }

  private isTranslateCall(node: Record<string, unknown>): boolean {
    if (node.type !== 'function') {
      return false;
    }

    const procedure = node.procedure as Record<string, unknown> | undefined;
    if (!procedure) {
      return false;
    }

    if (
      procedure.type === 'path' &&
      Array.isArray(procedure.steps) &&
      (procedure.steps[0] as any)?.value === 't'
    ) {
      return true;
    }

    if (procedure.type === 'variable' && procedure.value === 't') {
      return true;
    }

    return false;
  }
}
