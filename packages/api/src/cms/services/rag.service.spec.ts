/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { HelperService } from '@/helper/helper.service';
import { BaseRagHelper } from '@/helper/lib/base-rag-helper';
import { HelperType } from '@/helper/types';
import { LoggerService } from '@/logger/logger.service';

import { ContentService } from './content.service';
import { RagService } from './rag.service';

type MockHelper = Partial<
  Pick<BaseRagHelper, 'getName' | 'index' | 'remove' | 'reindex' | 'retrieve'>
>;

describe('RagService (orchestrator)', () => {
  let ragService: RagService;
  let helperService: { getDefaultHelper: jest.Mock; get: jest.Mock };
  let contentService: { findOneAndPopulate: jest.Mock; find: jest.Mock };
  let logger: { error: jest.Mock };

  const setDefaultHelper = (helper: MockHelper | Error) => {
    if (helper instanceof Error) {
      helperService.getDefaultHelper.mockRejectedValue(helper);
    } else {
      helperService.getDefaultHelper.mockResolvedValue({
        getName: () => 'default-rag',
        ...helper,
      });
    }
  };

  beforeEach(() => {
    helperService = { getDefaultHelper: jest.fn(), get: jest.fn() };
    contentService = { findOneAndPopulate: jest.fn(), find: jest.fn() };
    logger = { error: jest.fn() };
    ragService = new RagService(
      helperService as unknown as HelperService,
      contentService as unknown as ContentService,
      logger as unknown as LoggerService,
    );
  });

  describe('content upsert forwarding', () => {
    it('indexes created/updated content when the helper maintains an index', async () => {
      const content = { id: 'c1', title: 'A' };
      contentService.findOneAndPopulate.mockResolvedValue(content);
      const index = jest.fn().mockResolvedValue(undefined);
      setDefaultHelper({ index });

      await ragService.handleContentUpserted({ entity: { id: 'c1' } } as any);

      expect(contentService.findOneAndPopulate).toHaveBeenCalledWith('c1');
      expect(index).toHaveBeenCalledWith(content);
    });

    it('is a no-op for a retrieval-only helper (no index hook)', async () => {
      setDefaultHelper({});

      await ragService.handleContentUpserted({ entity: { id: 'c1' } } as any);

      expect(contentService.findOneAndPopulate).not.toHaveBeenCalled();
    });

    it('ignores events without an entity id', async () => {
      const index = jest.fn();
      setDefaultHelper({ index });

      await ragService.handleContentUpserted({ entity: undefined } as any);

      expect(index).not.toHaveBeenCalled();
    });

    it('never throws when helper resolution fails', async () => {
      setDefaultHelper(new Error('no helper'));

      await expect(
        ragService.handleContentUpserted({ entity: { id: 'c1' } } as any),
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('content delete forwarding', () => {
    it('removes deleted content when the helper maintains an index', async () => {
      const remove = jest.fn().mockResolvedValue(undefined);
      setDefaultHelper({ remove });

      await ragService.handleContentDeleted({ entity: { id: 'c1' } } as any);

      expect(remove).toHaveBeenCalledWith('c1');
    });

    it('falls back to databaseEntity id', async () => {
      const remove = jest.fn().mockResolvedValue(undefined);
      setDefaultHelper({ remove });

      await ragService.handleContentDeleted({
        databaseEntity: { id: 'c2' },
      } as any);

      expect(remove).toHaveBeenCalledWith('c2');
    });

    it('is a no-op for a retrieval-only helper (no remove hook)', async () => {
      setDefaultHelper({});

      await ragService.handleContentDeleted({ entity: { id: 'c1' } } as any);

      expect(contentService.find).not.toHaveBeenCalled();
    });
  });

  describe('content type cascade', () => {
    it('captures child ids on preDelete and removes them on postDelete', async () => {
      const remove = jest.fn().mockResolvedValue(undefined);
      setDefaultHelper({ remove });
      contentService.find.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);

      await ragService.handleContentTypeDeleting({
        databaseEntity: { id: 'ct1' },
      } as any);
      await ragService.handleContentTypeDeleted({
        entity: { id: 'ct1' },
      } as any);

      expect(contentService.find).toHaveBeenCalledWith({
        where: { contentType: { id: 'ct1' } },
      });
      expect(remove).toHaveBeenCalledWith('c1');
      expect(remove).toHaveBeenCalledWith('c2');
    });

    it('does not capture ids when the helper has no remove hook', async () => {
      setDefaultHelper({});

      await ragService.handleContentTypeDeleting({
        databaseEntity: { id: 'ct1' },
      } as any);

      expect(contentService.find).not.toHaveBeenCalled();
    });
  });

  describe('default helper change', () => {
    it('reindexes the newly selected helper when it supports it', async () => {
      const reindex = jest.fn().mockResolvedValue(undefined);
      helperService.get.mockReturnValue({
        getName: () => 'pgvector',
        reindex,
      });

      await ragService.handleDefaultRagHelperChanged({ value: 'pgvector' });

      expect(helperService.get).toHaveBeenCalledWith(
        HelperType.RAG,
        'pgvector',
      );
      expect(reindex).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the helper has no reindex hook', async () => {
      setDefaultHelper({});

      await expect(
        ragService.handleDefaultRagHelperChanged(),
      ).resolves.toBeUndefined();
    });

    it('serializes concurrent reindex requests for the same helper', async () => {
      let completeReindex!: () => void;
      const reindex = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            completeReindex = resolve;
          }),
      );
      setDefaultHelper({ reindex });

      const first = ragService.reindexAll();
      const second = ragService.reindexAll();
      await new Promise((resolve) => setImmediate(resolve));

      expect(reindex).toHaveBeenCalledTimes(1);
      completeReindex();
      await Promise.all([first, second]);
    });
  });
});
