/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  Workflow as AgenticWorkflow,
  WorkflowDefinition,
} from '@hexabot-ai/agentic';
import { DataSource } from 'typeorm';

import { WorkflowRunCreateDto } from '@/workflow/dto/workflow-run.dto';
import { WorkflowRunOrmEntity } from '@/workflow/entities/workflow-run.entity';
import { WorkflowVersionOrmEntity } from '@/workflow/entities/workflow-version.entity';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';
import {
  DirectionType,
  WorkflowType,
  WorkflowVersionAction,
} from '@/workflow/types';

import { installUserFixturesTypeOrm, userFixtureIds } from './user';

type WorkflowRunOrmFixture = WorkflowRunCreateDto & {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
  suspendedAt?: Date | null;
  finishedAt?: Date | null;
  failedAt?: Date | null;
  duration?: number | null;
};

export const workflowRunWorkflowFixtureId =
  '99999999-9999-9999-9999-999999999999';

export const workflowRunWorkflowVersionFixtureId =
  '99999999-9999-9999-9999-999999999998';

export const workflowRunFixtureIds = {
  running: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  finished: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
} as const;

const workflowRunWorkflowDefinition: WorkflowDefinition = {
  defs: {
    noop: {
      kind: 'task',
      action: 'noop_task',
    },
  },
  flow: [{ do: 'noop' }],
  outputs: {
    result: '="ok"',
  },
};

export const workflowRunOrmFixtures: WorkflowRunOrmFixture[] = [
  {
    id: workflowRunFixtureIds.running,
    createdAt: new Date('2024-06-02T08:00:00.000Z'),
    updatedAt: new Date('2024-06-02T08:00:00.000Z'),
    workflow: workflowRunWorkflowFixtureId,
    workflowVersion: workflowRunWorkflowVersionFixtureId,
    triggeredBy: userFixtureIds.admin,
    parentRun: null,
    status: 'running',
    input: { source: 'fixture' },
    output: null,
    context: { step: 'start' },
    snapshot: null,
    checkpoint: null,
    error: null,
    suspendedAt: null,
    finishedAt: null,
    failedAt: null,
    duration: null,
    metadata: { run: 'alpha' },
    stepLog: null,
  },
  {
    id: workflowRunFixtureIds.finished,
    createdAt: new Date('2024-06-02T09:00:00.000Z'),
    updatedAt: new Date('2024-06-02T10:00:00.000Z'),
    workflow: workflowRunWorkflowFixtureId,
    workflowVersion: workflowRunWorkflowVersionFixtureId,
    triggeredBy: null,
    parentRun: null,
    status: 'finished',
    input: null,
    output: { result: 'ok' },
    context: { step: 'complete' },
    snapshot: null,
    checkpoint: null,
    error: null,
    suspendedAt: null,
    finishedAt: new Date('2024-06-02T10:00:00.000Z'),
    failedAt: null,
    duration: 60 * 60 * 1000,
    metadata: null,
    stepLog: null,
  },
];

const findRunsWithRelations = async (dataSource: DataSource) =>
  await dataSource.getRepository(WorkflowRunOrmEntity).find({
    relations: ['workflow', 'workflowVersion', 'triggeredBy', 'parentRun'],
  });
const ensureWorkflowFixture = async (dataSource: DataSource) => {
  const workflowRepository = dataSource.getRepository(WorkflowOrmEntity);
  const versionRepository = dataSource.getRepository(WorkflowVersionOrmEntity);
  const existing = await workflowRepository.findOne({
    where: { id: workflowRunWorkflowFixtureId },
    relations: ['currentVersion'],
  });

  if (existing) {
    const currentId = existing.currentVersion?.id;
    if (currentId === workflowRunWorkflowVersionFixtureId) {
      return existing;
    }

    const definitionYml = AgenticWorkflow.stringifyDefinition(
      workflowRunWorkflowDefinition,
    );
    const latestVersion = await versionRepository.findOne({
      where: { workflow: { id: existing.id } },
      order: { version: 'DESC' },
    });
    const version = await versionRepository.save(
      versionRepository.create({
        id: workflowRunWorkflowVersionFixtureId,
        workflow: existing,
        version: (latestVersion?.version ?? 0) + 1,
        definitionYml,
        action: WorkflowVersionAction.create,
        createdBy: existing.createdBy
          ? { id: existing.createdBy.id }
          : undefined,
      }),
    );

    existing.currentVersion = version;

    return await workflowRepository.save(existing);
  }

  const [user] = await installUserFixturesTypeOrm(dataSource);
  const entity = workflowRepository.create({
    id: workflowRunWorkflowFixtureId,
    name: 'workflow_run_fixture',
    description: 'Workflow used by workflow run fixtures.',
    type: WorkflowType.conversational,
    schedule: null,
    createdBy: user ? { id: user.id } : undefined,
    builtin: false,
    direction: DirectionType.HORIZONTAL,
    x: 0,
    y: 0,
    zoom: 1,
  });
  const workflow = await workflowRepository.save(entity);
  const definitionYml = AgenticWorkflow.stringifyDefinition(
    workflowRunWorkflowDefinition,
  );
  const version = await versionRepository.save(
    versionRepository.create({
      id: workflowRunWorkflowVersionFixtureId,
      workflow,
      version: 1,
      definitionYml,
      action: WorkflowVersionAction.create,
      createdBy: user ? { id: user.id } : undefined,
    }),
  );

  workflow.currentVersion = version;

  return await workflowRepository.save(workflow);
};

export const installWorkflowRunFixturesTypeOrm = async (
  dataSource: DataSource,
) => {
  await installUserFixturesTypeOrm(dataSource);
  await ensureWorkflowFixture(dataSource);

  const repository = dataSource.getRepository(WorkflowRunOrmEntity);

  if (await repository.count()) {
    return await findRunsWithRelations(dataSource);
  }

  const entities = workflowRunOrmFixtures.map((fixture) =>
    repository.create({
      id: fixture.id,
      workflow: { id: fixture.workflow },
      workflowVersion: fixture.workflowVersion
        ? { id: fixture.workflowVersion }
        : null,
      triggeredBy: fixture.triggeredBy ? { id: fixture.triggeredBy } : null,
      parentRun: fixture.parentRun ? { id: fixture.parentRun } : null,
      status: fixture.status ?? 'idle',
      input: fixture.input ?? null,
      output: fixture.output ?? null,
      context: fixture.context ?? null,
      snapshot: fixture.snapshot ?? null,
      checkpoint: fixture.checkpoint ?? null,
      error: fixture.error ?? null,
      suspendedAt: fixture.suspendedAt ?? null,
      finishedAt: fixture.finishedAt ?? null,
      failedAt: fixture.failedAt ?? null,
      metadata: fixture.metadata ?? null,
      createdAt: fixture.createdAt,
      updatedAt: fixture.updatedAt,
    }),
  );

  await repository.save(entities);

  return await findRunsWithRelations(dataSource);
};
