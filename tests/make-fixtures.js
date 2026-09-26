/**
 * Generates FAKE sources with the same shape as the real ones.
 *
 * For the tests only: they check the join, the percentiles and the failures
 * without depending on the network. The numbers are invented and must never be
 * confused with real data — which is why these files land in tests/fixtures/
 * and never in data/sources/.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

/** @param {{name:string, whr:number}[]} rows */
export async function writeWhrXlsx(file, rows, { leadingRows = 0 } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Figure 2.1');
  // Some editions put a title above the headers.
  for (let i = 0; i < leadingRows; i += 1) {
    ws.addRow(i === 0 ? ['Figure 2.1: Ranking of happiness'] : []);
  }
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
  // Regional aggregates: empty code or an OWID pseudo-code. They get dropped.
  lines.push(`World,OWID_WRL,${year},9.2`);
  lines.push(`Europe,,${year},11.4`);
  lines.push(`High-income countries,,${year},10.1`);
  for (const r of rows) {
    // An earlier year for each country: the parser must keep only the latest.
    lines.push(`${r.entity},${r.code},${previousYear},${(r.rate + 1.5).toFixed(2)}`);
    lines.push(`${r.entity},${r.code},${year},${r.rate.toFixed(2)}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}
