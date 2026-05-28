export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
}

interface PaginableDelegate<T, A> {
  findMany(args: A): Promise<T[]>;
  count(args: { where?: A extends { where?: infer W } ? W : unknown }): Promise<number>;
}

export const isPaginatedResult = (v: unknown): v is PaginatedResult<unknown> =>
  !!v &&
  typeof v === 'object' &&
  Array.isArray((v as PaginatedResult<unknown>).items) &&
  typeof (v as PaginatedResult<unknown>).total === 'number' &&
  typeof (v as PaginatedResult<unknown>).page === 'number' &&
  typeof (v as PaginatedResult<unknown>).limit === 'number';

export async function paginate<T, A extends { where?: unknown; skip?: number; take?: number }>(
  delegate: PaginableDelegate<T, A>,
  args: A,
  page = 1,
  limit = 20,
): Promise<PaginatedResult<T>> {
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    delegate.findMany({ ...args, skip, take: safeLimit }),
    delegate.count({ where: (args as { where?: unknown }).where as A extends { where?: infer W } ? W : unknown }),
  ]);

  const pages = Math.max(1, Math.ceil(total / safeLimit));
  return {
    items,
    total,
    page: safePage,
    limit: safeLimit,
    pages,
    hasNext: safePage < pages,
  };
}
