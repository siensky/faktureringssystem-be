import { useInfiniteQuery } from "@tanstack/react-query";

interface OffsetPage<T> {
  items: T[];
  hasMore: boolean;
}

/**
 * Sidbläddring för admin-listorna (kunder/fakturor/leveranser). Backend
 * cappar hårt vid PAGE_MAX (200) och svarar med `hasMore` — utan den här
 * hooken lästes `hasMore` aldrig, så en tenant med fler än 200 rader
 * tappade resten tyst ur listan.
 */
export function useOffsetList<T>(
  queryKey: readonly unknown[],
  fetchPage: (offset: number) => Promise<OffsetPage<T>>,
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.reduce((count, page) => count + page.items.length, 0) : undefined,
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return { ...query, items };
}
