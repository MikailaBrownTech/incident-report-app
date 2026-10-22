/**
 * Class names for a table that stacks into labelled cards on phones and is a real table from `md` up.
 * Each <td> sets `data-label`; use `role` attributes too, since `display: block` drops native table semantics.
 */
export const tableWrap = "rounded border border-border";
export const table = "block w-full text-left text-sm md:table";
export const thead = "sr-only md:not-sr-only md:table-header-group border-b border-border bg-surface text-muted";
export const tbody = "block md:table-row-group";
export const tr = "block border-b border-border p-2 last:border-b-0 md:table-row md:p-0";
export const th = "p-3 font-medium";
export const td =
  "block px-3 py-1.5 md:table-cell md:p-3 before:block before:text-xs before:text-muted before:content-[attr(data-label)] md:before:hidden";
