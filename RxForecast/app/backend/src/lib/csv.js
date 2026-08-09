// Minimal RFC4180-ish CSV parser — no npm dependency needed for the demo.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') {
      if (text[i - 1] !== '\r' || field !== '' || row.length > 0) {
        row.push(field); field = '';
        if (!(row.length === 1 && row[0] === '')) rows.push(row);
        row = [];
      }
    } else if (c === '\r') { /* skip, \n handles the row break */ }
    else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).filter(r => r.length === header.length).map(r => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx]; });
    return obj;
  });
}

export function toNum(v, fallback = 0) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

export function toBool(v) {
  return v === 'true' || v === 'TRUE' || v === '1' || v === true;
}
