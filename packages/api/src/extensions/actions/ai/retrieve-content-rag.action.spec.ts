/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { ActionService } from '@/actions/actions.service';
import {
  RagHelperConfigurationError,
  RagHelperUnavailableError,
} from '@/cms/errors/rag.errors';
import { WorkflowRuntimeContext } from '@/workflow/contexts/workflow-runtime.context';

import { RetrieveRagContentAction } from './retrieve-content-rag.action';

describe('RetrieveRagContentAction', () => {
  let actionService: ActionService;
  let action: InstanceType<typeof RetrieveRagContentAction>;
  let contentService: { retrieve: jest.Mock };
  let contentTypeService: { findOne: jest.Mock };
  let context: WorkflowRuntimeContext;

  beforeEach(() => {
    jest.clearAllMocks();
    actionService = { register: jest.fn() } as unknown as ActionService;
    action = new RetrieveRagContentAction(actionService);
    contentService = {
      retrieve: jest.fn(),
    };
    contentTypeService = {
      findOne: jest.fn().mockResolvedValue({ id: 'ct-1' }),
    };
    context = {
      services: {
        content: contentService,
        contentType: contentTypeService,
        logger: { warn: jest.fn() },
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

  it('accepts and ignores the deprecated mode setting', async () => {
    contentService.retrieve.mockResolvedValue([]);

    const settings = action.parseSettings({
      mode: 'embedding',
      include_inactive: false,
    });
    await action.execute({
      input: { query: 'product' },
      context,
      settings,
      bindings: {} as any,
    });

    expect(contentService.retrieve).toHaveBeenCalledWith('product', {
      includeInactive: false,
    });
  });

  it('maps settings to RAG options and returns structured hits', async () => {
    const hits = [
      {
        contentId: 'content-1',
        title: 'Product A',
        text: 'Product details',
        score: 0.91,
        contentTypeId: 'ct-1',
        source: 'fulltext-search',
      },
    ];
    contentService.retrieve.mockResolvedValue(hits);

    const result = await action.execute({
      input: { query: 'product' },
      context,
      settings: {
        limit: 5,
        content_type_id: 'ct-1',
        include_inactive: true,
      } as any,
      bindings: {} as any,
    });

    expect(contentTypeService.findOne).toHaveBeenCalledWith('ct-1');
    expect(contentService.retrieve).toHaveBeenCalledWith('product', {
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

  it('propagates retrieval errors', async () => {
    contentService.retrieve.mockRejectedValue(
      new Error('Unable to run full-text search.'),
    );

    await expect(
      action.execute({
        input: { query: 'product' },
        context,
        settings: {
          include_inactive: false,
        } as any,
        bindings: {} as any,
      }),
    ).rejects.toThrow('Unable to run full-text search.');
  });

  it.each([
    new RagHelperConfigurationError('missing key'),
    new RagHelperUnavailableError('missing extension'),
  ])(
    'turns known helper configuration failures into warnings',
    async (error) => {
      contentService.retrieve.mockRejectedValue(error);
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
        warning: error.message,
      });
      expect(context.services.logger?.warn).toHaveBeenCalled();
    },
  );

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
