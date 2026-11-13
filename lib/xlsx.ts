/** Een .xlsx schrijven zonder externe bibliotheek: de onderdelen zijn XML-bestanden in een zip. */

export type Lijn = 'thin' | 'medium' | 'thick';

export interface Stijl {
  font?: { naam?: string; grootte?: number; vet?: boolean; kleur?: string };
  /** Achtergrondkleur als RGB, bijv. 'BFBFBF'. */
  vulling?: string;
  rand?: { l?: Lijn; r?: Lijn; t?: Lijn; b?: Lijn };
  uitlijning?: { h?: 'left' | 'center' | 'right'; v?: 'top' | 'center' | 'bottom'; terugloop?: boolean };
}

/** Tekst, getal of formule (zonder '='). */
type Waarde = string | number | { f: string } | null;

export interface Cel {
  v: Waarde;
  s?: Stijl;
}

export interface Opmaakregel {
  /** Bereik, bijv. 'C47:NI47' of meerdere gescheiden door een spatie. */
  bereik: string;
  operator: 'equal' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual' | 'between';
  /** Eén formule, of twee bij between (zonder '='), bijv. '"DG"', '1', '$A$2-1'. */
  formules: string[];
  vulling?: string;
  kleur?: string;
}

export interface Blad {
  naam: string;
  /** rij (1-based) -> kolom (1-based) -> cel */
  rijen: Map<number, Map<number, Cel>>;
  breedtes: { van: number; tot: number; breedte: number; verborgen?: boolean }[];
  hoogtes?: Map<number, number>;
  samengevoegd: string[];
  /** Eerste cel die niet vastgezet is (bijv. rij 7, kolom 3 voor C7). */
  vast?: { rij: number; kolom: number };
  zoom?: number;
  regels: Opmaakregel[];
  liggend?: boolean;
  tabKleur?: string;
}

export function nieuwBlad(naam: string): Blad {
  return { naam, rijen: new Map(), breedtes: [], samengevoegd: [], regels: [] };
}

export function zet(b: Blad, rij: number, kolom: number, v: Waarde, s?: Stijl): void {
  let r = b.rijen.get(rij);
  if (!r) b.rijen.set(rij, (r = new Map()));
  r.set(kolom, { v, s });
}

/** Kolomletter: 1 -> A, 27 -> AA. */
export function kol(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export const ref = (rij: number, kolom: number) => `${kol(kolom)}${rij}`;

/** Bladnaam zoals Excel hem toestaat (max. 31 tekens, zonder []:*?/\). */
export function bladNaam(n: string): string {
  return n.replace(/[[\]:*?/\\]/g, '-').slice(0, 31);
}

/** Bladnaam in een formule: tussen enkele aanhalingstekens als dat nodig is. */
export function bladRef(n: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const argb = (rgb: string) => `FF${rgb.replace(/^#/, '').toUpperCase()}`;

class Stijlen {
  fonts = ['<font><sz val="11"/><name val="Aptos Narrow"/><family val="2"/></font>'];
  fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  dxfs: string[] = [];
  /** Zodat dezelfde opmaak maar één keer in het bestand staat. */
  private index = new Map<string[], Map<string, number>>();

  private eenmalig(lijst: string[], xml: string): number {
    let m = this.index.get(lijst);
    if (!m) this.index.set(lijst, (m = new Map(lijst.map((x, i) => [x, i]))));
    let i = m.get(xml);
    if (i == null) { lijst.push(xml); i = lijst.length - 1; m.set(xml, i); }
    return i;
  }

  xf(s?: Stijl): number {
    if (!s) return 0;
    const f = s.font ?? {};
    const font = this.eenmalig(this.fonts, `<font>${f.vet ? '<b/>' : ''}<sz val="${f.grootte ?? 11}"/>${f.kleur ? `<color rgb="${argb(f.kleur)}"/>` : ''}<name val="${esc(f.naam ?? 'Aptos Narrow')}"/><family val="2"/></font>`);
    const fill = s.vulling ? this.eenmalig(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.vulling)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const r = s.rand ?? {};
    const lijn = (tag: string, l?: Lijn) => (l ? `<${tag} style="${l}"><color indexed="64"/></${tag}>` : `<${tag}/>`);
    const border = s.rand ? this.eenmalig(this.borders, `<border>${lijn('left', r.l)}${lijn('right', r.r)}${lijn('top', r.t)}${lijn('bottom', r.b)}<diagonal/></border>`) : 0;
    const u = s.uitlijning;
    const al = u ? `<alignment${u.h ? ` horizontal="${u.h}"` : ''}${u.v ? ` vertical="${u.v}"` : ''}${u.terugloop ? ' wrapText="1"' : ''}/>` : '';
    return this.eenmalig(this.xfs, `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${al ? ' applyAlignment="1"' : ''}>${al}</xf>`);
  }

  dxf(r: Opmaakregel): number {
    const xml = `<dxf>${r.kleur ? `<font><color rgb="${argb(r.kleur)}"/></font>` : ''}${r.vulling ? `<fill><patternFill patternType="solid"><bgColor rgb="${argb(r.vulling)}"/></patternFill></fill>` : ''}</dxf>`;
    return this.eenmalig(this.dxfs, xml);
  }

  xml(): string {
    const lijst = (tag: string, l: string[]) => `<${tag} count="${l.length}">${l.join('')}</${tag}>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${lijst('fonts', this.fonts)}${lijst('fills', this.fills)}${lijst('borders', this.borders)}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>${lijst('cellXfs', this.xfs)}<cellStyles count="1"><cellStyle name="Standaard" xfId="0" builtinId="0"/></cellStyles>${lijst('dxfs', this.dxfs)}</styleSheet>`;
  }
}

function bladXml(b: Blad, st: Stijlen, actief: boolean): string {
  const rijNrs = [...b.rijen.keys()].sort((a, c) => a - c);
  let maxKol = 1;
  for (const r of b.rijen.values()) for (const k of r.keys()) maxKol = Math.max(maxKol, k);
  const maxRij = rijNrs.length ? rijNrs[rijNrs.length - 1] : 1;
  const delen: string[] = [];
  delen.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`);
  if (b.tabKleur) delen.push(`<sheetPr><tabColor rgb="${argb(b.tabKleur)}"/></sheetPr>`);
  delen.push(`<dimension ref="A1:${ref(maxRij, maxKol)}"/>`);
  const v = b.vast;
  const pane = v ? `<pane${v.kolom > 1 ? ` xSplit="${v.kolom - 1}"` : ''}${v.rij > 1 ? ` ySplit="${v.rij - 1}"` : ''} topLeftCell="${ref(v.rij, v.kolom)}" activePane="${v.kolom > 1 && v.rij > 1 ? 'bottomRight' : v.rij > 1 ? 'bottomLeft' : 'topRight'}" state="frozen"/>` : '';
  delen.push(`<sheetViews><sheetView${actief ? ' tabSelected="1"' : ''}${b.zoom ? ` zoomScale="${b.zoom}" zoomScaleNormal="${b.zoom}"` : ''} workbookViewId="0">${pane}</sheetView></sheetViews>`);
  delen.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (b.breedtes.length) {
    delen.push(`<cols>${[...b.breedtes].sort((a, c) => a.van - c.van).map((c) => `<col min="${c.van}" max="${c.tot}" width="${c.breedte}" customWidth="1"${c.verborgen ? ' hidden="1"' : ''}/>`).join('')}</cols>`);
  }
  delen.push('<sheetData>');
  for (const rn of rijNrs) {
    const r = b.rijen.get(rn)!;
    const h = b.hoogtes?.get(rn);
    const cellen: string[] = [];
    for (const k of [...r.keys()].sort((a, c) => a - c)) {
      const c = r.get(k)!;
      const s = st.xf(c.s);
      const at = `r="${ref(rn, k)}"${s ? ` s="${s}"` : ''}`;
      const w = c.v;
      if (w == null || w === '') cellen.push(`<c ${at}/>`);
      else if (typeof w === 'number') cellen.push(`<c ${at}><v>${w}</v></c>`);
      else if (typeof w === 'string') cellen.push(`<c ${at} t="inlineStr"><is><t xml:space="preserve">${esc(w)}</t></is></c>`);
      else cellen.push(`<c ${at}><f>${esc(w.f)}</f></c>`);
    }
    delen.push(`<row r="${rn}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cellen.join('')}</row>`);
  }
  delen.push('</sheetData>');
  if (b.samengevoegd.length) delen.push(`<mergeCells count="${b.samengevoegd.length}">${b.samengevoegd.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`);
  let prio = 1;
  const perBereik = new Map<string, Opmaakregel[]>();
  for (const r of b.regels) perBereik.set(r.bereik, [...(perBereik.get(r.bereik) ?? []), r]);
  for (const [bereik, regels] of perBereik) {
    delen.push(`<conditionalFormatting sqref="${bereik}">${regels.map((r) => `<cfRule type="cellIs" dxfId="${st.dxf(r)}" priority="${prio++}" operator="${r.operator}">${r.formules.map((f) => `<formula>${esc(f)}</formula>`).join('')}</cfRule>`).join('')}</conditionalFormatting>`);
  }
  delen.push('<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>');
  if (b.liggend) delen.push('<pageSetup paperSize="9" orientation="landscape"/>');
  delen.push('</worksheet>');
  return delen.join('');
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inpakken(d: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const s = new ReadableStream<BufferSource>({ start(c) { c.enqueue(d as BufferSource); c.close(); } }).pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  } catch {
    return null;
  }
}

/** Ongecomprimeerd als de browser niet kan inpakken. */
async function zip(bestanden: { naam: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const delen: Uint8Array[] = [];
  const centraal: Uint8Array[] = [];
  let offset = 0;
  for (const b of bestanden) {
    const naam = new TextEncoder().encode(b.naam);
    const crc = crc32(b.data);
    const klein = await inpakken(b.data);
    const methode = klein && klein.length < b.data.length ? 8 : 0;
    const inhoud = methode ? klein! : b.data;
    const kop = new DataView(new ArrayBuffer(30));
    kop.setUint32(0, 0x04034b50, true); kop.setUint16(4, 20, true); kop.setUint16(6, 0x0800, true); kop.setUint16(8, methode, true);
    kop.setUint16(10, 0, true); kop.setUint16(12, 0x21, true); kop.setUint32(14, crc, true);
    kop.setUint32(18, inhoud.length, true); kop.setUint32(22, b.data.length, true); kop.setUint16(26, naam.length, true); kop.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, methode, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, inhoud.length, true); c.setUint32(24, b.data.length, true);
    c.setUint16(28, naam.length, true); c.setUint32(42, offset, true);
    delen.push(new Uint8Array(kop.buffer), naam, inhoud);
    centraal.push(new Uint8Array(c.buffer), naam);
    offset += 30 + naam.length + inhoud.length;
  }
  const grootte = centraal.reduce((a, x) => a + x.length, 0);
  const eind = new DataView(new ArrayBuffer(22));
  eind.setUint32(0, 0x06054b50, true); eind.setUint16(8, bestanden.length, true); eind.setUint16(10, bestanden.length, true);
  eind.setUint32(12, grootte, true); eind.setUint32(16, offset, true);
  const alles = [...delen, ...centraal, new Uint8Array(eind.buffer)];
  const uit = new Uint8Array(alles.reduce((a, x) => a + x.length, 0));
  let p = 0;
  for (const x of alles) { uit.set(x, p); p += x.length; }
  return uit;
}

/** actief: het blad dat open staat. */
export async function schrijfXlsx(bladen: Blad[], actief = 0): Promise<Uint8Array> {
  const st = new Stijlen();
  const enc = new TextEncoder();
  const bladXmls = bladen.map((b, i) => bladXml(b, st, i === actief));
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${bladen.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${actief}"/></bookViews><sheets>${bladen.map((b, i) => `<sheet name="${esc(b.naam)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${bladen.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${bladen.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zip([
    { naam: '[Content_Types].xml', data: enc.encode(ct) },
    { naam: '_rels/.rels', data: enc.encode(rels) },
    { naam: 'xl/workbook.xml', data: enc.encode(wb) },
    { naam: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    ...bladXmls.map((x, i) => ({ naam: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(x) })),
    // stijlen als laatste: pas na het schrijven van de bladen zijn alle stijlen bekend
    { naam: 'xl/styles.xml', data: enc.encode(st.xml()) },
  ]);
}
