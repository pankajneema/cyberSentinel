/**
 * Client-side CSV export from an array of row objects. Real file download — no
 * backend round-trip needed for data already loaded in the table.
 */
export function exportRowsToCsv(rows: Record<string, unknown>[], filename: string): void {
  if (!rows || rows.length === 0) return;
  const keys = Object.keys(rows[0] || {});
  const lines = [
    keys.join(","),
    ...rows.map((row) => keys.map((k) => JSON.stringify(row[k] ?? "")).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
