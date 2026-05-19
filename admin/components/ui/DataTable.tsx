"use client";

import { type ReactNode, useMemo, useState } from "react";

// DataTable — typed, sortable, paginated client-side table. Generic
// over a row type T so column definitions get full type inference for
// `key` (must be a key of T). Sort is per-column; pagination is page
// size + page number (no virtualization — admin pages are small).

export interface DataTableColumn<T> {
  key: keyof T & string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  /** Render a cell value into a ReactNode (e.g. date formatting). */
  formatter?: (value: T[keyof T], row: T) => ReactNode;
  width?: number | string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  emptyMessage?: string;
  initialPageSize?: 10 | 25 | 100;
  /** Stable identity for rows; falls back to index. */
  rowKey?: (row: T, index: number) => string;
}

type SortState<T> = { key: keyof T & string; dir: "asc" | "desc" } | null;

function compare<T>(a: T, b: T, key: keyof T & string, dir: "asc" | "desc"): number {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  let cmp = 0;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = av - bv;
  } else {
    cmp = String(av).localeCompare(String(bv));
  }
  return dir === "asc" ? cmp : -cmp;
}

export default function DataTable<T>({
  columns,
  data,
  emptyMessage = "No data",
  initialPageSize = 25,
  rowKey,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState<T>>(null);
  const [pageSize, setPageSize] = useState<10 | 25 | 100>(initialPageSize);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return data;
    const copy = [...data];
    copy.sort((a, b) => compare(a, b, sort.key, sort.dir));
    return copy;
  }, [data, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const visible = sorted.slice(start, start + pageSize);

  function toggleSort(col: DataTableColumn<T>) {
    if (!col.sortable) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: "asc" };
      if (prev.dir === "asc") return { key: col.key, dir: "desc" };
      return null;
    });
  }

  if (data.length === 0) {
    return <div className="card muted">{emptyMessage}</div>;
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            {columns.map((col) => {
              const isSorted = sort?.key === col.key;
              const arrow = !isSorted ? "" : sort?.dir === "asc" ? " ▲" : " ▼";
              const align = col.align ?? "left";
              return (
                <th
                  key={col.key}
                  style={{
                    textAlign: align,
                    cursor: col.sortable ? "pointer" : "default",
                    width: col.width,
                    userSelect: "none",
                  }}
                  onClick={() => toggleSort(col)}
                  aria-sort={isSorted ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  {col.label}
                  {col.sortable ? <span style={{ color: "var(--accent)" }}>{arrow}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => {
            const key = rowKey ? rowKey(row, start + i) : String(start + i);
            return (
              <tr key={key}>
                {columns.map((col) => {
                  const raw = row[col.key];
                  const rendered = col.formatter ? col.formatter(raw, row) : (raw as ReactNode);
                  return (
                    <td key={col.key} style={{ textAlign: col.align ?? "left" }}>
                      {rendered as ReactNode}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--fg-muted)",
        }}
      >
        <span>
          {start + 1}–{Math.min(start + pageSize, sorted.length)} of {sorted.length}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <label htmlFor="page-size" style={{ margin: 0, fontSize: 11 }}>
            Page size
          </label>
          <select
            id="page-size"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as 10 | 25 | 100);
              setPage(0);
            }}
            style={{ width: 70, padding: "4px 8px" }}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={100}>100</option>
          </select>
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
          >
            ‹ Prev
          </button>
          <span>
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}
