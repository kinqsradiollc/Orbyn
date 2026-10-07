/** Search displayed choices without changing values, ordering, or the saved selection. */
export function filterChoices<
  T extends { value: string; label: string; searchText?: string },
>(choices: readonly T[], query: string): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...choices];
  return choices.filter((choice) => {
    const text =
      `${choice.value} ${choice.label} ${choice.searchText ?? ""}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
