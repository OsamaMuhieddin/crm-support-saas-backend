export const buildPagination = ({
  page = 1,
  limit = 10,
  total = 0,
  results = null
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeResults =
    results === null
      ? safeTotal
      : Math.max(0, Math.min(safeLimit, Number(results) || 0));

  return {
    page: safePage,
    limit: safeLimit,
    total: safeTotal,
    results: safeResults
  };
};
