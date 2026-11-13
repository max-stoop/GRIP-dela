
type Cel = string | number | null | undefined;

interface Blad {
  naam: string;
  rijen: Cel[][];
  /** In tekens; anders automatisch. */
  breedtes?: number[];
}

function download(blob: Blob, bestand: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = bestand;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadXlsx(data: Uint8Array, bestand: string) {
  download(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${bestand}.xlsx`);
}

export async function downloadExcel(bladen: Blad[], bestand: string) {
  // write-excel-file: de oude xlsx-bibliotheek had bekende kwetsbaarheden
  const { default: schrijf } = await import('write-excel-file/browser');
  const sheets = bladen.map((b) => {
    const w = b.breedtes ?? b.rijen.reduce<number[]>((acc, r) => {
      r.forEach((c, i) => { acc[i] = Math.max(acc[i] ?? 4, Math.min(40, String(c ?? '').length + 2)); });
      return acc;
    }, []);
    return {
      data: b.rijen.map((r) => r.map((c) => (c == null || c === '' ? null : c))),
      sheet: b.naam.replace(/[\\/?*[\]:]/g, '-').slice(0, 31),
      columns: w.map((width) => ({ width })),
    };
  });
  const blob = await schrijf(sheets).toBlob();
  download(blob, `${bestand}.xlsx`);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface PrintTabel {
  titel: string;
  ondertitel?: string;
  kop: string[];
  rijen: Cel[][];
  voet?: Cel[][];
  /** Zelfde vorm als rijen. */
  klassen?: (string | undefined)[][];
  liggend?: boolean;
}

/** Via "Opslaan als PDF" wordt het een PDF. */
export function afdrukken(t: PrintTabel) {
  const w = window.open('', '_blank');
  if (!w) throw new Error('Het afdrukvenster werd geblokkeerd. Sta pop-ups toe voor deze site.');
  const rij = (r: Cel[], k?: (string | undefined)[], tag = 'td') => `<tr>${r.map((c, i) => `<${tag} class="${k?.[i] ?? ''}">${esc(c)}</${tag}>`).join('')}</tr>`;
  w.document.write(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${esc(t.titel)}</title><style>
    @page{size:A4 ${t.liggend === false ? 'portrait' : 'landscape'};margin:10mm}
    body{font:10px/1.35 "Hanken Grotesk","Segoe UI",Arial,sans-serif;color:#1b2a33;margin:0}
    h1{font:600 19px/1.15 Literata,Georgia,serif;margin:0 0 2px;color:#0d4463}
    p{margin:0 0 8px;color:#56697a}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #d6e1e8;padding:2px 3px;text-align:center;white-space:nowrap}
    th{background:#e8eff3;font-weight:600}
    td:first-child,th:first-child{text-align:left}
    tfoot td{background:#f2f6f9;font-weight:700}
    .d1{background:#dcebf2}.d1M{background:#b9d9e7}.d2{background:#0d4463;color:#fff}
    .d1B{background:repeating-linear-gradient(135deg,#fbf1da 0 4px,#e9c97f 4px 6px);color:#8a5d00}
    .dDG2{background:#d3e9e7;color:#2d7473}.dDG1{background:#e8f4f3;color:#2d7473}
    .dO,.dO4,.dOR,.dVMS,.dTD{background:#e4eaee;color:#56697a}
    .dV{color:#56697a;font-style:italic;font-family:Literata,Georgia,serif}.dZ{background:#f6d9d9;color:#b23b3b}
    .we{background:#f2f6f9}
    .laag{color:#b23b3b}.hoog{color:#9a6700}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    footer{margin-top:6px;color:#56697a;font-size:9px}
  </style></head><body><h1>${esc(t.titel)}</h1>${t.ondertitel ? `<p>${esc(t.ondertitel)}</p>` : ''}
  <table><thead>${rij(t.kop, undefined, 'th')}</thead><tbody>${t.rijen.map((r, i) => rij(r, t.klassen?.[i])).join('')}</tbody>
  ${t.voet ? `<tfoot>${t.voet.map((r) => rij(r)).join('')}</tfoot>` : ''}</table>
  <footer>GRIP Regelplekken · afgedrukt ${new Date().toLocaleString('nl-NL')}</footer>
  <script>window.onload=function(){window.print();}</script></body></html>`);
  w.document.close();
}

interface AgendaItem {
  uid: string;
  datum: string;
  start?: number;
  eind?: number;
  titel: string;
  omschrijving?: string;
}

export function downloadIcs(items: AgendaItem[], bestand: string) {
  // tijden in hele minuten (9,5 uur = 09:30); 24 uur is middernacht van de volgende dag
  const t = (d: string, h: number) => {
    const min = Math.round(h * 60), dag = Math.floor(min / 1440), rest = min - dag * 1440;
    const datum = dag ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + dag)).toISOString().slice(0, 10) : d;
    return `${datum.replace(/-/g, '')}T${String(Math.floor(rest / 60)).padStart(2, '0')}${String(rest % 60).padStart(2, '0')}00`;
  };
  const tekst = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const regels = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GRIP//Regelplekken//NL', 'CALSCALE:GREGORIAN', 'X-WR-TIMEZONE:Europe/Amsterdam',
    // de tijdzone zelf, zodat elke agenda de tijden goed zet (zomer- en wintertijd)
    'BEGIN:VTIMEZONE', 'TZID:Europe/Amsterdam',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const i of items) {
    regels.push('BEGIN:VEVENT', `UID:${i.uid}@grip`, `DTSTAMP:${stamp}`);
    if (i.start != null && i.eind != null) regels.push(`DTSTART;TZID=Europe/Amsterdam:${t(i.datum, i.start)}`, `DTEND;TZID=Europe/Amsterdam:${t(i.datum, i.eind)}`);
    else regels.push(`DTSTART;VALUE=DATE:${i.datum.replace(/-/g, '')}`);
    regels.push(`SUMMARY:${tekst(i.titel)}`);
    if (i.omschrijving) regels.push(`DESCRIPTION:${tekst(i.omschrijving)}`);
    regels.push('END:VEVENT');
  }
  regels.push('END:VCALENDAR');
  download(new Blob([regels.join('\r\n')], { type: 'text/calendar' }), `${bestand}.ics`);
}

export function downloadBlob(blob: Blob, bestand: string) {
  download(blob, bestand);
}
