export const TRAINER_FETCH_PAGE_SIZE = 500;

export type PagedQueryError = { message?: string; code?: string } | null;

export async function fetchAllPaged<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PagedQueryError }>,
  pageSize: number = TRAINER_FETCH_PAGE_SIZE,
): Promise<T[]> {
  const size = Math.max(1, pageSize);
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await loadPage(from, from + size - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < size) break;
  }
  return rows;
}
