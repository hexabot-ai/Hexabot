/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Workflow, WorkflowDefinition } from '@hexabot-ai/agentic';
import { DataSource } from 'typeorm';

import {
  installUserFixturesTypeOrm,
  userFixtureIds,
} from '@/utils/test/fixtures/user';
import { WorkflowCreateDto } from '@/workflow/dto/workflow.dto';
import { WorkflowVersionOrmEntity } from '@/workflow/entities/workflow-version.entity';
import { WorkflowOrmEntity } from '@/workflow/entities/workflow.entity';
import {
  DirectionType,
  WorkflowType,
  WorkflowVersionAction,
} from '@/workflow/types';

type WorkflowFixture = WorkflowCreateDto & { definitionYml: string };

/**
 * Simple workflow definition that exercises the built-in messaging actions.
 * It sends an initial text and follows up with a quick reply prompt.
 */
export const messagingWorkflowDefinition: WorkflowDefinition = {
  defs: {
    send_greeting: {
      kind: 'task',
      action: 'send_text_message',
      inputs: {
        text: '="Welcome to Hexabot! Let us know how to help."',
      },
    },
    prompt_next_step: {
      kind: 'task',
      action: 'send_quick_replies',
      description: 'Offer quick replies to continue the conversation.',
      inputs: {
        text: '="What would you like to do next?"',
        quick_replies: [
          {
            title: 'Get help',
            payload: 'help',
          },
          {
            title: 'Talk to agent',
            payload: 'agent',
          },
        ],
      },
    },
  },
  flow: [{ do: 'send_greeting' }, { do: 'prompt_next_step' }],
  outputs: {
    last_prompt: '=$output.prompt_next_step.text ?? ""',
  },
};

/**
 * Scheduled workflow definition used to validate cron-based execution.
 */
export const scheduledWorkflowDefinition: WorkflowDefinition = {
  defs: {
    send_update: {
      kind: 'task',
      // Dummy action used only for scheduled workflow testing.
      action: 'noop_task',
      inputs: {
        note: '="Scheduled workflow executed"',
      },
    },
  },
  flow: [{ do: 'send_update' }],
  outputs: {
    status: '="ok"',
  },
};

export const messagingWorkflowFixtures: WorkflowFixture[] = [
  {
    name: 'messaging_workflow_fixture',
    description: 'Test workflow using messaging actions.',
    definitionYml: Workflow.stringifyDefinition(messagingWorkflowDefinition),
    type: WorkflowType.conversational,
    schedule: null,
    createdBy: userFixtureIds.admin,
    direction: DirectionType.HORIZONTAL,
    x: 0,
    y: 0,
    zoom: 1,
    builtin: false,
  },
];

export const scheduledWorkflowFixtures: WorkflowFixture[] = [
  {
    name: 'scheduled_workflow_fixture',
    description: 'Test workflow triggered on a schedule.',
    definitionYml: Workflow.stringifyDefinition(scheduledWorkflowDefinition),
    type: WorkflowType.scheduled,
    schedule: '*/10 * * * * *',
    createdBy: userFixtureIds.admin,
    builtin: false,
  },
];

const installWorkflowFixtures = async (
  dataSource: DataSource,
  fixtures: WorkflowFixture[],
): Promise<WorkflowOrmEntity[]> => {
  await installUserFixturesTypeOrm(dataSource);
  const workflowRepository = dataSource.getRepository(WorkflowOrmEntity);
  const versionRepository = dataSource.getRepository(WorkflowVersionOrmEntity);

  if (await workflowRepository.count()) {
    return await workflowRepository.find({
      relations: ['createdBy', 'currentVersion'],
    });
  }

  const workflowEntities = workflowRepository.create(
    fixtures.map(({ definitionYml: _, ...fixture }) => {
      return {
        ...fixture,
        createdBy: fixture.createdBy ? { id: fixture.createdBy } : undefined,
      };
    }),
  );
  const workflows = await workflowRepository.save(workflowEntities);
  const versions = await versionRepository.save(
    fixtures.map((fixture, index) => {
      return versionRepository.create({
        workflow: workflows[index],
        version: 1,
        definitionYml: fixture.definitionYml,
        action: WorkflowVersionAction.create,
        createdBy: fixture.createdBy ? { id: fixture.createdBy } : undefined,
      });
    }),
  );

  workflows.forEach((workflow, index) => {
    workflow.currentVersion = versions[index];
  });

  await workflowRepository.save(workflows);

  return workflows;
};

export const installScheduledWorkflowFixturesTypeOrm = async (
  dataSource: DataSource,
): Promise<WorkflowOrmEntity[]> => {
  return await installWorkflowFixtures(dataSource, scheduledWorkflowFixtures);
};

export const installMessagingWorkflowFixturesTypeOrm = async (
  dataSource: DataSource,
): Promise<WorkflowOrmEntity[]> => {
  return await installWorkflowFixtures(dataSource, messagingWorkflowFixtures);
};
