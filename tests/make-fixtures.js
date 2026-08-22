/**
 * Genera fonti FINTE con la stessa forma di quelle vere.
 *
 * Servono solo ai test: verificano il join, i percentili e i fallimenti senza
 * dipendere dalla rete. I numeri sono inventati e non vanno mai confusi con i
 * dati reali — per questo i file finiscono in tests/fixtures/ e mai in
 * data/sources/.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

/** @param {{name:string, whr:number}[]} rows */
export async function writeWhrXlsx(file, rows, { leadingRows = 0 } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Figure 2.1');
  // Alcune edizioni antepongono un titolo alle intestazioni.
  for (let i = 0; i < leadingRows; i += 1) ws.addRow(i === 0 ? ['Figure 2.1: Ranking of happiness'] : []);
  ws.addRow(['Country name', 'Ladder score', 'upperwhisker', 'lowerwhisker']);
  for (const r of rows) ws.addRow([r.name, r.whr, r.whr + 0.05, r.whr - 0.05]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await wb.xlsx.writeFile(file);
}

/** @param {{entity:string, code:string, rate:number}[]} rows */
export function writeSuicideCsv(file, rows, { year = 2021, previousYear = 2019 } = {}) {
  const header =
    'Entity,Code,Year,"Age-standardized deaths from self-harm per 100,000 people, both sexes"';
  const lines = [header];
  // Aggregati regionali: codice vuoto o pseudo-codice OWID. Vanno scartati.
  lines.push(`World,OWID_WRL,${year},9.2`);
  lines.push(`Europe,,${year},11.4`);
  lines.push(`High-income countries,,${year},10.1`);
  for (const r of rows) {
    // Un anno precedente per ogni paese: il parser deve tenere solo il piu' recente.
    lines.push(`${r.entity},${r.code},${previousYear},${(r.rate + 1.5).toFixed(2)}`);
    lines.push(`${r.entity},${r.code},${year},${r.rate.toFixed(2)}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}
