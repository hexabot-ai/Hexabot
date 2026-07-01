/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Workflow } from '@hexabot-ai/types';
import { TestingModule } from '@nestjs/testing';

import { I18nService } from '@/i18n/services/i18n.service';
import { buildTestingMocks } from '@/utils/test/utils';
import { WorkflowService } from '@/workflow/services/workflow.service';
import { WorkflowType } from '@/workflow/types';

import { TranslationRepository } from '../repositories/translation.repository';
import { TranslationService } from '../services/translation.service';

describe('TranslationService', () => {
  let module: TestingModule;
  let service: TranslationService;
  let i18nService: I18nService<unknown>;
  let workflowService: jest.Mocked<WorkflowService>;

  const workflowFixtures: Workflow[] = [
    {
      id: 'workflow-1',
      name: 'demo',
      version: '1.0.0',
      description: 'Workflow description',
      definition: {
        workflow: { description: 'Internal workflow description' },
        defs: {
          send_text: {
            kind: 'task',
            action: 'send_text_message',
            description: '=$t("Task description to ignore")',
            inputs: {
              text: "=$t('Hello user')",
              nested: { caption: '="Some prefix " & $t("Nested caption")' },
              plain: 'Just text',
            },
          },
        },
        flow: [{ do: 'send_text' }],
      },
      type: WorkflowType.conversational,
      schedule: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Workflow,
    {
      id: 'workflow-2',
      name: 'secondary',
      version: '0.1.0',
      definition: {
        defs: {
          ask_choice: {
            kind: 'task',
            action: 'send_quick_replies',
            settings: {
              prompt: '=$t("Settings prompt")',
              nested: { fallback: '=$t("Nested settings fallback")' },
            },
            inputs: {
              title: "=$t('Pick one')",
              subtitle:
                '="Join " & $t(\'First option\') & " and " & $t("Second option")',
              items: ['=$t("One")', 'Two'],
            },
          },
        },
        flow: [{ do: 'ask_choice' }],
      },
      type: WorkflowType.conversational,
      schedule: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Workflow,
  ];

  beforeEach(async () => {
    workflowService = {
      findAndPopulate: jest.fn().mockResolvedValue(workflowFixtures),
    } as unknown as jest.Mocked<WorkflowService>;

    const testing = await buildTestingMocks({
      providers: [
        TranslationService,
        {
          provide: TranslationRepository,
          useValue: {
            isFindOptions: jest.fn().mockReturnValue(false),
            getEventEmitter: jest.fn().mockReturnValue(undefined),
            findAll: jest.fn().mockResolvedValue([
              {
                key: 'test',
                value: 'test',
                lang: 'en',
              },
            ]),
          },
        },
        { provide: WorkflowService, useValue: workflowService },
      ],
    });

    module = testing.module;
    [service, i18nService] = await testing.getMocks([
      TranslationService,
      I18nService,
    ]);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should call refreshDynamicTranslations with translations from findAll', async () => {
    jest.spyOn(i18nService, 'refreshDynamicTranslations');
    await service.resetI18nTranslations();
    expect(i18nService.refreshDynamicTranslations).toHaveBeenCalledWith([
      {
        key: 'test',
        value: 'test',
        lang: 'en',
      },
    ]);
  });

  it('should collect translation strings declared via $t in workflow tasks', async () => {
    const strings = await service.getAllWorkflowStrings();

    expect(strings).toEqual(
      expect.arrayContaining([
        'Hello user',
        'Nested caption',
        'Pick one',
        'First option',
        'Second option',
        'One',
        'Settings prompt',
        'Nested settings fallback',
      ]),
    );
    expect(strings).not.toContain('Two');
    expect(strings).not.toContain('Send greeting');
    expect(strings).not.toContain('Workflow description');
    expect(strings).not.toContain('Internal workflow description');
    expect(strings).not.toContain('Task description to ignore');
  });
});
