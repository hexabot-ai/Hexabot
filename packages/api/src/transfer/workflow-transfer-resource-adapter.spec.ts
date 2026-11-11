/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import type { BaseOrmEntity } from '@/database/entities/base.entity';

import { WorkflowTransferImportResults } from './workflow-transfer-resource-adapter';

const entity = (id: string) => ({ id }) as BaseOrmEntity<any>;

describe('WorkflowTransferImportResults', () => {
  it('returns an empty result when nothing was imported', () => {
    expect(new WorkflowTransferImportResults('label').toResult()).toStrictEqual(
      {
        idMap: {},
        resources: [],
        warnings: [],
        postCreateEvents: [],
      },
    );
  });

  it('maps reused and created resources and keeps their order', () => {
    const results = new WorkflowTransferImportResults('label');
    const created = entity('local-2');
    const payload = { name: 'second' };

    results.reused({ exportId: 'export-1', name: 'first' }, 'local-1');
    results.created({ exportId: 'export-2', name: 'second' }, created, payload);

    const result = results.toResult();

    expect(result.idMap).toStrictEqual({
      'export-1': 'local-1',
      'export-2': 'local-2',
    });
    expect(result.resources).toStrictEqual([
      {
        kind: 'label',
        exportId: 'export-1',
        localId: 'local-1',
        name: 'first',
        action: 'reused',
      },
      {
        kind: 'label',
        exportId: 'export-2',
        localId: 'local-2',
        name: 'second',
        action: 'created',
      },
    ]);
    expect(result.postCreateEvents).toStrictEqual([
      { entityName: 'label', entity: created, payload },
    ]);
  });

  it('reports the action given to a created resource', () => {
    const results = new WorkflowTransferImportResults('credential');

    results.created(
      { exportId: 'export-1', name: 'api key' },
      entity('local-1'),
      {},
      'placeholder_created',
    );

    expect(results.toResult().resources[0].action).toBe('placeholder_created');
  });

  it('collects warnings and adds metadata only when given', () => {
    const results = new WorkflowTransferImportResults('mcpServer');
    const metadata = { placeholderExportIds: new Set(['export-1']) };

    results.warn('first warning');
    results.warn('second warning');

    expect(results.toResult().warnings).toStrictEqual([
      'first warning',
      'second warning',
    ]);
    expect(results.toResult()).not.toHaveProperty('metadata');
    expect(results.toResult(metadata).metadata).toBe(metadata);
  });

  it('refuses a resource without a local id', () => {
    const results = new WorkflowTransferImportResults('contentType');

    expect(() =>
      results.reused({ exportId: 'export-1', name: 'faq' }, ''),
    ).toThrow('Missing local ID for imported contentType');
    expect(results.toResult().idMap).toStrictEqual({});
  });
});
