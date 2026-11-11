/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Logger } from '@nestjs/common';
import { FindOperator, ILike, In, IsNull, Not } from 'typeorm';

import { TypeOrmSearchFilterPipe } from './typeorm-search-filter.pipe';

type TestEntity = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  owner: { id: string; country: string };
};

describe('TypeOrmSearchFilterPipe', () => {
  const pipe = new TypeOrmSearchFilterPipe<TestEntity>({
    allowedFields: ['name', 'email'] as any,
    defaultSort: ['createdAt', 'desc'],
  });

  it('should transform equality filters into TypeORM where clause', async () => {
    const result = await pipe.transform(
      {
        where: { name: 'John Doe' },
      } as any,
      {} as any,
    );

    expect(result.where).toEqual({ name: 'John Doe' });
  });

  it('should create ILike operator for contains filters', async () => {
    const result = await pipe.transform(
      {
        where: { email: { contains: 'example' } },
      } as any,
      {} as any,
    );
    const where = result.where as Record<string, FindOperator<string>>;
    expect(where.email).toBeInstanceOf(FindOperator);
    expect(where.email.type).toBe('ilike');
  });

  it('should combine OR conditions into an array of where clauses', async () => {
    const result = await pipe.transform(
      {
        where: {
          or: [{ name: 'John' }, { email: { contains: 'example' } }],
        },
      } as any,
      {} as any,
    );

    expect(Array.isArray(result.where)).toBe(true);
    const [first, second] = result.where as Array<Record<string, unknown>>;
    expect(first).toEqual({ name: 'John' });
    expect(second.email).toBeInstanceOf(FindOperator);
  });

  it('should parse pagination parameters', async () => {
    const result = await pipe.transform(
      {
        where: {},
        skip: '5',
        limit: '10',
      } as any,
      {} as any,
    );

    expect(result.skip).toBe(5);
    expect(result.take).toBe(10);
  });

  it('should parse sort parameter and fallback to default sort', async () => {
    const withSort = await pipe.transform(
      {
        where: {},
        sort: 'name asc',
      } as any,
      {} as any,
    );

    expect(withSort.order).toEqual({ name: 'ASC' });

    const defaultSort = await pipe.transform(
      {
        where: {},
      } as any,
      {} as any,
    );

    expect(defaultSort.order).toEqual({ createdAt: 'DESC' });
  });

  // Each OR branch must inherit the AND filter (owner.id) while overriding it
  // where they overlap (owner.country), without leaking into its siblings.
  it('should keep every OR branch independent when nested with an AND filter', async () => {
    const nestedPipe = new TypeOrmSearchFilterPipe<TestEntity>({
      allowedFields: ['owner.id', 'owner.country'],
    });
    const result = await nestedPipe.transform(
      {
        where: {
          'owner.id': 'OWNER-1',
          or: [
            { 'owner.country': 'United Kingdom' },
            { 'owner.country': 'United States' },
          ],
        },
      } as any,
      {} as any,
    );

    expect(result.where).toEqual([
      { owner: { id: 'OWNER-1', country: 'United Kingdom' } },
      { owner: { id: 'OWNER-1', country: 'United States' } },
    ]);
  });

  describe('where clause', () => {
    const where = async (query: Record<string, unknown>) =>
      (await pipe.transform({ where: query } as any, {} as any)).where;

    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('returns none without filters', async () => {
      expect(await where({})).toBeUndefined();
      expect(
        (await pipe.transform({} as any, {} as any)).where,
      ).toBeUndefined();
    });

    it('returns none when no filter has a value', async () => {
      expect(await where({ name: '  ', email: [] })).toBeUndefined();
    });

    it('ignores and reports the fields that are not allowed', async () => {
      expect(await where({ id: 'user-1', name: 'John' })).toEqual({
        name: 'John',
      });
      expect(warnSpy).toHaveBeenCalledWith('Field id is not allowed');
    });

    it('reads `or` clauses given as an object', async () => {
      expect(
        await where({
          or: { 0: { name: 'John' }, 1: { email: 'john@example.com' } },
        }),
      ).toEqual([{ name: 'John' }, { email: 'john@example.com' }]);
    });

    it('skips empty and refused `or` clauses', async () => {
      expect(
        await where({
          or: [null, {}, { id: 'user-1' }, { name: 'John' }],
        }),
      ).toEqual([{ name: 'John' }]);
      expect(warnSpy).toHaveBeenCalledWith('Field id is not allowed');
    });

    it('reads the first field of an `or` clause only', async () => {
      expect(
        await where({ or: [{ name: 'John', email: 'john@example.com' }] }),
      ).toEqual([{ name: 'John' }]);
    });

    it('returns the `and` filters when no `or` clause has a value', async () => {
      expect(
        await where({ name: 'John', or: [{ email: { contains: '' } }] }),
      ).toEqual({ name: 'John' });
    });

    it('merges the `and` filters into every `or` clause', async () => {
      expect(
        await where({
          name: 'John',
          or: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
        }),
      ).toEqual([
        { name: 'John', email: 'a@example.com' },
        { name: 'John', email: 'b@example.com' },
      ]);
    });

    it('lets an `or` clause override the `and` filter of the same field', async () => {
      expect(await where({ name: 'John', or: [{ name: 'Jane' }] })).toEqual([
        { name: 'Jane' },
      ]);
    });

    it('normalizes equality values', async () => {
      expect(await where({ name: ' John ' })).toEqual({ name: 'John' });
      expect(await where({ name: 'NULL' })).toEqual({ name: IsNull() });
      expect(await where({ name: 'true' })).toEqual({ name: true });
      expect(await where({ name: 'False' })).toEqual({ name: false });
      expect(await where({ name: ['John', ' ', 'null'] })).toEqual({
        name: In(['John']),
      });
      expect(await where({ name: ['null', 'null'] })).toEqual({
        name: IsNull(),
      });
    });

    it('builds the `!=` and `$in` operators', async () => {
      expect(await where({ name: { '!=': 'John' } })).toEqual({
        name: Not('John'),
      });
      expect(await where({ name: { '!=': 'null' } })).toEqual({
        name: Not(IsNull()),
      });
      expect(await where({ name: { '!=': ' ' } })).toBeUndefined();
      expect(
        await where({ name: { $in: ['John', ' Jane ', '', 'null'] } }),
      ).toEqual({ name: In(['John', 'Jane']) });
      expect(await where({ name: { $in: [] } })).toBeUndefined();
    });

    it('escapes the LIKE wildcards of `contains` values', async () => {
      expect(await where({ name: { contains: '50%_off' } })).toEqual({
        name: ILike('%50\\%\\_off%'),
      });
      expect(await where({ name: { name: { contains: 'Jo' } } })).toEqual({
        name: ILike('%Jo%'),
      });
    });
  });

  describe('prototype pollution prevention', () => {
    it.each(['__proto__', 'constructor', 'prototype'])(
      'should reject sort field containing %s',
      async (forbidden) => {
        const result = await pipe.transform(
          {
            where: {},
            sort: `${forbidden}.polluted asc`,
          } as any,
          {} as any,
        );

        expect(result.order).toEqual({ createdAt: 'DESC' });
        expect(({} as any).polluted).toBeUndefined();
      },
    );

    it.each(['__proto__', 'constructor', 'prototype'])(
      'should reject bracket-notation sort field containing %s',
      async (forbidden) => {
        const result = await pipe.transform(
          {
            where: {},
            sort: `${forbidden}[polluted] asc`,
          } as any,
          {} as any,
        );

        expect(result.order).toEqual({ createdAt: 'DESC' });
        expect(({} as any).polluted).toBeUndefined();
      },
    );

    it.each(['__proto__', 'constructor', 'prototype'])(
      'should ignore where clause with %s in path',
      async (forbidden) => {
        const pipeWithAllowed = new TypeOrmSearchFilterPipe<TestEntity>({
          allowedFields: [forbidden] as any,
        });
        const result = await pipeWithAllowed.transform(
          {
            where: { [forbidden]: 'polluted' },
          } as any,
          {} as any,
        );

        expect(result.where).toBeUndefined();
        expect(({} as any).polluted).toBeUndefined();
      },
    );
  });
});
