/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import {
  ArgumentMetadata,
  Injectable,
  Logger,
  PipeTransform,
} from '@nestjs/common';
import set from 'lodash/set';
import {
  FindManyOptions,
  FindOptionsOrder,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  Like,
  Not,
} from 'typeorm';

import { hasForbiddenSegment } from '../helpers/safe-property-path';
import {
  TFilterNestedKeysOfType,
  TSearchFilterValue,
} from '../types/filter.types';

export type QuerySortDirection = 'ASC' | 'DESC' | 'asc' | 'desc';

export type QuerySortDto<T> = [keyof T & string, QuerySortDirection];

export type PageQueryParams = {
  skip?: string;
  limit?: string;
  sort?: string;
};

type TypeOrmSearchFilterPipeConfig<T> = {
  allowedFields: TFilterNestedKeysOfType<T>[];
  defaultSort?: QuerySortDto<T>;
};

type TypeOrmQuery<T> = TSearchFilterValue<T> & PageQueryParams;

type TypeOrmOperator = 'eq' | 'contains' | 'neq' | 'in';

type TypeOrmFilterToken = {
  field: string;
  operator: TypeOrmOperator;
  value: unknown;
};

@Injectable()
export class TypeOrmSearchFilterPipe<T>
  implements PipeTransform<TypeOrmQuery<T>, Promise<FindManyOptions<T>>>
{
  private readonly allowedFields: TypeOrmSearchFilterPipeConfig<T>['allowedFields'];

  private readonly defaultSort?: QuerySortDto<T>;

  constructor(private readonly config: TypeOrmSearchFilterPipeConfig<T>) {
    this.allowedFields = config.allowedFields;
    this.defaultSort = config.defaultSort;
  }

  async transform(
    value: TypeOrmQuery<T>,
    _metadata: ArgumentMetadata,
  ): Promise<FindManyOptions<T>> {
    const options: FindManyOptions<T> = {};
    const where = this.buildWhereClause(value);
    if (where) {
      options.where = where;
    }

    const skip = this.parseNumber(value.skip);
    if (skip !== undefined) {
      options.skip = skip;
    }

    const take = this.parseNumber(value.limit, { min: 1 });
    if (take !== undefined) {
      options.take = take;
    }

    const order = this.parseSort(value.sort) ?? this.parseDefaultSort();
    if (order) {
      options.order = { ...(options.order ?? {}), ...order };
    }

    return options;
  }

  private buildWhereClause(
    value: TypeOrmQuery<T>,
  ): FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined {
    const { or: orParams, ...andParams } = (value['where'] ?? {}) as Record<
      string,
      unknown
    >;
    const orClauses = this.buildClauses(this.getOrEntries(orParams));
    const andClauses = this.buildClauses(Object.entries(andParams));
    const baseWhere = andClauses.reduce(
      (merged, clause) => this.mergeWhereObjects(merged, clause),
      {} as FindOptionsWhere<T>,
    );
    const hasBase = this.hasWhereEntries(baseWhere);

    if (!orClauses.length) {
      return hasBase ? baseWhere : undefined;
    }

    if (!hasBase) {
      return orClauses;
    }

    return orClauses.map((clause) => this.mergeWhereObjects(baseWhere, clause));
  }

  /** Reads the field of each `or` clause, given as an array or an object. */
  private getOrEntries(orParams: unknown): [string, unknown][] {
    if (!orParams) {
      return [];
    }

    const clauses = Array.isArray(orParams)
      ? orParams
      : Object.values(orParams as Record<string, unknown>);

    return clauses.flatMap((clause) => {
      // Only the first field of a clause is read.
      const [entry] = clause
        ? Object.entries(clause as Record<string, unknown>)
        : [];

      return entry ? [entry] : [];
    });
  }

  /** Builds the clause of each allowed field that has a value. */
  private buildClauses(entries: [string, unknown][]): FindOptionsWhere<T>[] {
    return entries.flatMap(([field, value]) => {
      if (!this.isAllowedField(field)) {
        return [];
      }

      const clause = this.buildTypeOrmClause(
        this.transformFieldToToken(field, value),
      );

      return clause ? [clause] : [];
    });
  }

  private parseNumber(
    value?: string,
    constraints?: { min?: number },
  ): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }

    if (constraints?.min !== undefined && parsed < constraints.min) {
      return undefined;
    }

    return parsed;
  }

  private parseSort(sort?: string): FindOptionsOrder<T> | undefined {
    if (!sort) {
      return undefined;
    }

    const [field = '', direction = 'desc'] = sort.trim().split(/\s+/);
    if (!field || hasForbiddenSegment(field)) {
      return undefined;
    }

    const normalized = direction.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    return set({}, field, normalized) as FindOptionsOrder<T>;
  }

  private parseDefaultSort(): FindOptionsOrder<T> | undefined {
    if (!this.defaultSort) {
      return undefined;
    }

    const [field, direction] = this.defaultSort;
    if (!field) {
      return undefined;
    }

    const normalized =
      typeof direction === 'number'
        ? direction >= 0
          ? 'ASC'
          : 'DESC'
        : String(direction).toLowerCase() === 'asc'
          ? 'ASC'
          : 'DESC';

    return {
      [field as keyof T]: normalized,
    } as FindOptionsOrder<T>;
  }

  private isAllowedField(field: string): boolean {
    if (this.allowedFields.includes(field as TFilterNestedKeysOfType<T>)) {
      return true;
    }
    Logger.warn(`Field ${field} is not allowed`);

    return false;
  }

  private transformFieldToToken(
    field: string,
    val?: unknown,
  ): TypeOrmFilterToken {
    if (val && typeof val === 'object') {
      const record = val as Record<string, unknown>;

      if ('contains' in record || record?.[field]?.['contains']) {
        const contains =
          record['contains'] ??
          record?.[field]?.['contains'] ??
          record?.[field];

        return {
          field,
          operator: 'contains',
          value: contains,
        };
      }

      if ('!=' in record) {
        return {
          field,
          operator: 'neq',
          value: record['!='],
        };
      }

      if ('$in' in record) {
        return {
          field,
          operator: 'in',
          value: record['$in'],
        };
      }
    }

    return {
      field,
      operator: 'eq',
      value: val,
    };
  }

  private buildTypeOrmClause(
    token: TypeOrmFilterToken,
  ): FindOptionsWhere<T> | null {
    const value = this.resolveTypeOrmValue(token.operator, token.value);
    if (value === undefined) return null;

    const clause: Record<string, unknown> = {};
    this.assignNestedWhereValue(clause, token.field, value);

    return clause as FindOptionsWhere<T>;
  }

  private resolveTypeOrmValue(
    operator: TypeOrmOperator,
    rawValue: unknown,
  ): unknown {
    switch (operator) {
      case 'contains': {
        const stringValue = this.toStringValue(rawValue);
        if (!stringValue) return undefined;
        const escaped = this.escapeLikePattern(stringValue);
        try {
          return ILike(`%${escaped}%`);
        } catch {
          return Like(`%${escaped}%`);
        }
      }
      case 'neq': {
        const equality = this.resolveEqualityValue(rawValue);

        return equality === undefined ? undefined : Not(equality);
      }
      case 'in': {
        const values = this.ensureArray(rawValue)
          .map((value) => this.normalizePrimitive(value))
          .filter(
            (value): value is Exclude<typeof value, null | undefined> =>
              value !== undefined && value !== null,
          );

        if (!values.length) {
          return undefined;
        }

        return In(values);
      }
      case 'eq':
      default:
        return this.resolveEqualityValue(rawValue);
    }
  }

  private resolveEqualityValue(rawValue: unknown): unknown {
    const values = this.ensureArray(rawValue)
      .map((value) => this.normalizePrimitive(value))
      .filter((value) => value !== undefined);

    if (!values.length) {
      return undefined;
    }

    if (values.length === 1) {
      const [value] = values;
      if (value === null) {
        return IsNull();
      }

      return value;
    }

    const nonNullValues = values.filter(
      (value): value is Exclude<typeof value, null> => value !== null,
    );

    if (!nonNullValues.length) {
      return IsNull();
    }

    return In(nonNullValues);
  }

  private assignNestedWhereValue(
    target: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    if (value === undefined || hasForbiddenSegment(path)) return;
    const segments = path.split('.');
    let cursor = target;

    for (let index = 0; index < segments.length - 1; index++) {
      const segment = segments[index];
      if (!this.isPlainObject(cursor[segment])) {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }

    cursor[segments[segments.length - 1]] = value;
  }

  // Must stay pure: the same base clause is merged into every `or` branch.
  private mergeWhereObjects(
    left: FindOptionsWhere<T>,
    right: FindOptionsWhere<T>,
  ): FindOptionsWhere<T> {
    const merged = {
      ...left,
    };

    for (const [key, value] of Object.entries(right)) {
      if (value === undefined || hasForbiddenSegment(key)) {
        continue;
      }

      const existing = merged[key];
      merged[key] =
        this.isPlainObject(existing) && this.isPlainObject(value)
          ? this.mergeWhereObjects(
              existing as FindOptionsWhere<T>,
              value as FindOptionsWhere<T>,
            )
          : value;
    }

    return merged as FindOptionsWhere<T>;
  }

  private hasWhereEntries(where: FindOptionsWhere<T>): boolean {
    return Object.keys(where as Record<string, unknown>).length > 0;
  }

  private ensureArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (value === undefined) {
      return [];
    }

    return [value];
  }

  private normalizePrimitive(value: unknown): unknown {
    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (trimmed.length === 0) {
        return undefined;
      }

      const lower = trimmed.toLowerCase();

      if (lower === 'null') {
        return null;
      }

      if (lower === 'true') {
        return true;
      }

      if (lower === 'false') {
        return false;
      }

      return trimmed;
    }

    return value;
  }

  private toStringValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (value === null || value === undefined) {
      return '';
    }

    return String(value);
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/[%_]/g, (match) => `\\${match}`);
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    return Object.getPrototypeOf(value) === Object.prototype;
  }
}
