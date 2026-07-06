/**
 * Minimal RFC-4180 CSV — parse and stringify, no dependencies.
 * Competitor exports (Jobber/Tradify/ServiceM8) use quoted fields with
 * embedded commas and newlines, so a split(',') parser is not enough.
 */

/** Parse CSV text into rows of fields. Handles quoted fields, "" escapes,
 *  CRLF and LF line ends, and a UTF-8 BOM. Fully empty lines are skipped. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // A "row" that is a single empty field is a blank line — drop it
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ',') {
      endField();
      i++;
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      endRow();
      i++;
    } else if (ch === '\n') {
      endRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

export type CsvRows = (string | number | null | undefined)[][];

/** RFC-4180 stringify. Quotes fields containing , " or newlines; CRLF rows. */
export function toCsv(rows: CsvRows): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell === null || cell === undefined ? '' : String(cell);
          return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

/** BOM prefix so Excel opens UTF-8 (customer names, £-adjacent text) cleanly. */
export function csvText(rows: CsvRows): string {
  return '﻿' + toCsv(rows);
}

/** CSV download response with a dated filename. */
export function csvResponse(filenameBase: string, rows: CsvRows): Response {
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csvText(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameBase}-${date}.csv"`,
    },
  });
}
