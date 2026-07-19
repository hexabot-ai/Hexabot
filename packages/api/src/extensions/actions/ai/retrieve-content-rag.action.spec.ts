/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ActionService } from '@/actions/actions.service';
import { RagEmbeddingNotConfiguredError } from '@/cms';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { RetrieveRagContentAction } from './retrieve-content-rag.action';

describe('RetrieveRagContentAction', () => {
  let actionService: ActionService;
  let action: InstanceType<typeof RetrieveRagContentAction>;
  let contentService: { retrieve: jest.Mock; isRagEnabled: jest.Mock };
  let contentTypeService: { findOne: jest.Mock };
  let loggerService: { warn: jest.Mock };
  let context: WorkflowRuntimeContext;

  beforeEach(() => {
    jest.clearAllMocks();
    actionService = { register: jest.fn() } as unknown as ActionService;
    action = new RetrieveRagContentAction(actionService);
    contentService = {
      retrieve: jest.fn(),
      isRagEnabled: jest.fn().mockResolvedValue(true),
    };
    contentTypeService = {
      findOne: jest.fn().mockResolvedValue({ id: 'ct-1' }),
    };
    loggerService = {
      warn: jest.fn(),
    };
    context = {
      services: {
        content: contentService,
        contentType: contentTypeService,
        logger: loggerService,
      },
    } as unknown as WorkflowRuntimeContext;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('rejects empty query input', () => {
    expect(() => action.parseInput({ query: '   ' })).toThrow();
  });

  it('accepts minimal input and defaults include_inactive to false', () => {
    const parsedInput = action.parseInput({ query: '  product info  ' });
    const parsedSettings = action.parseSettings({});

    expect(parsedInput).toEqual({ query: 'product info' });
    expect(parsedSettings.include_inactive).toBe(false);
  });

  it('maps settings to RAG options and returns structured hits', async () => {
    const hits = [
      {
        contentId: 'content-1',
        title: 'Product A',
        text: 'Product details',
        score: 0.91,
        contentTypeId: 'ct-1',
        source: 'embedding',
      },
    ];
    contentService.retrieve.mockResolvedValue(hits);

    const result = await action.execute({
      input: { query: 'product' },
      context,
      settings: {
        mode: 'embedding',
        limit: 5,
        content_type_id: 'ct-1',
        include_inactive: true,
      } as any,
      bindings: {} as any,
    });

    expect(contentTypeService.findOne).toHaveBeenCalledWith('ct-1');
    expect(contentService.retrieve).toHaveBeenCalledWith('product', {
      mode: 'embedding',
      limit: 5,
      contentTypeId: 'ct-1',
      includeInactive: true,
    });
    expect(result).toEqual({ hits, text: 'Product details' });
  });

  it('searches all content types when content_type_id is omitted or blank', async () => {
    contentService.retrieve.mockResolvedValue([]);

    await action.execute({
      input: { query: 'all products' },
      context,
      settings: {
        content_type_id: '   ',
        include_inactive: false,
      } as any,
      bindings: {} as any,
    });

    expect(contentTypeService.findOne).not.toHaveBeenCalled();
    expect(contentService.retrieve).toHaveBeenCalledWith('all products', {
      includeInactive: false,
    });
  });

  it('throws when configured content type does not exist', async () => {
    contentTypeService.findOne.mockResolvedValue(undefined);

    await expect(
      action.execute({
        input: { query: 'product' },
        context,
        settings: {
          content_type_id: 'missing-content-type',
          include_inactive: false,
        } as any,
        bindings: {} as any,
      }),
    ).rejects.toThrow('Content type with id "missing-content-type" not found');

    expect(contentService.retrieve).not.toHaveBeenCalled();
  });

  it('returns a warning instead of empty hits when RAG is disabled', async () => {
    contentService.isRagEnabled.mockResolvedValue(false);

    const result = await action.execute({
      input: { query: 'product' },
      context,
      settings: {
        include_inactive: false,
      } as any,
      bindings: {} as any,
    });

    expect(result).toEqual({
      hits: [],
      text: '',
      warning:
        'RAG is disabled. Enable it in Settings > RAG (rag_settings.enabled) to retrieve content.',
    });
    expect(contentService.retrieve).not.toHaveBeenCalled();
    expect(loggerService.warn).toHaveBeenCalledWith(
      expect.stringContaining('RAG is disabled'),
    );
  });

  it('returns a warning when embedding retrieval is not configured', async () => {
    contentService.retrieve.mockRejectedValue(
      new RagEmbeddingNotConfiguredError(
        'Missing RAG embedding API key. Set rag_settings.embedding_api_key.',
      ),
    );

    const result = await action.execute({
      input: { query: 'product' },
      context,
      settings: {
        mode: 'embedding',
        include_inactive: false,
      } as any,
      bindings: {} as any,
    });

    expect(result).toEqual({
      hits: [],
      text: '',
      warning: expect.stringContaining('rag_settings.embedding_api_key'),
    });
    expect(loggerService.warn).toHaveBeenCalledWith(
      expect.stringContaining('rag_settings.embedding_api_key'),
    );
  });

  it('rethrows non-configuration retrieval errors', async () => {
    contentService.retrieve.mockRejectedValue(
      new Error('Unable to initialize RAG embedding index.'),
    );

    await expect(
      action.execute({
        input: { query: 'product' },
        context,
        settings: {
          mode: 'embedding',
          include_inactive: false,
        } as any,
        bindings: {} as any,
      }),
    ).rejects.toThrow('Unable to initialize RAG embedding index.');
  });

  it('throws when required content services are missing from context', async () => {
    const invalidContext = {
      services: {
        contentType: contentTypeService,
      },
    } as unknown as WorkflowRuntimeContext;

    await expect(
      action.execute({
        input: { query: 'product' },
        context: invalidContext,
        settings: {
          include_inactive: false,
        } as any,
        bindings: {} as any,
      }),
    ).rejects.toThrow(
      'Content RAG services are missing from the workflow context.',
    );
  });
});
