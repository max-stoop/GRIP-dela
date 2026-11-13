import { describe, it, expect } from 'vitest';
import { isoRange } from '@/lib/dates';
import { kol, bladRef, nieuwBlad, zet, schrijfXlsx } from '@/lib/xlsx';
import { exportCode, exportRijen, jaarDagen, jaarroosterBladen, wijzigingenTekst, type ExportRegio } from '@/lib/rooster/jaarExport';
import type { Medewerker } from '@/lib/rooster/types';

/** De bestanden uit een zip (onze eigen zip: grootte staat in de lokale kop). */
async function unzip(data: Uint8Array): Promise<Map<string, string>> {
  const uit = new Map<string, string>();
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const methode = v.getUint16(p + 8, true), grootte = v.getUint32(p + 18, true), nl = v.getUint16(p + 26, true);
    const naam = new TextDecoder().decode(data.subarray(p + 30, p + 30 + nl));
    const inhoud = data.subarray(p + 30 + nl, p + 30 + nl + grootte);
    const ruw = methode === 8
      ? new Uint8Array(await new Response(new ReadableStream<BufferSource>({ start(c) { c.enqueue(inhoud as BufferSource); c.close(); } }).pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
      : inhoud;
    uit.set(naam, new TextDecoder().decode(ruw));
    p += 30 + nl + grootte;
  }
  return uit;
}

const mw = (id: string, naam: string, contract = 32, extra: Partial<Medewerker> = {}): Medewerker => ({ id, regio: 'Amsterdam', naam, contract, voorkeur: 'O', weekendgroep: 0, actief: true, ...extra });

describe('Excel schrijven', () => {
  it('kolomletters en bladnamen in formules', () => {
    expect([kol(1), kol(26), kol(27), kol(52), kol(396)]).toEqual(['A', 'Z', 'AA', 'AZ', 'OF']);
    expect(bladRef('NHN')).toBe('NHN');
    expect(bladRef('NHN uren')).toBe("'NHN uren'");
  });

  it('een geldige werkmap met formules, samengevoegde cellen en kleurregels', async () => {
    const b = nieuwBlad('Test');
    zet(b, 1, 1, 'tekst & <meer>', { vulling: 'BFBFBF', font: { vet: true } });
    zet(b, 1, 2, 3);
    zet(b, 2, 2, { f: 'SUM(B1:B1)+COUNTIF(A1:A1,"x")' });
    b.samengevoegd.push('A1:A2');
    b.regels.push({ bereik: 'B1:B2', operator: 'equal', formules: ['"DG"'], vulling: 'ED7D31' });
    b.vast = { rij: 2, kolom: 2 };
    const bestanden = await unzip(await schrijfXlsx([b, nieuwBlad('Tweede')]));
    expect([...bestanden.keys()]).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']));
    for (const [, x] of bestanden) expect(new DOMParser().parseFromString(x, 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0);
    const blad = bestanden.get('xl/worksheets/sheet1.xml')!;
    expect(blad).toContain('tekst &amp; &lt;meer&gt;');
    expect(blad).toContain('<f>SUM(B1:B1)+COUNTIF(A1:A1,&quot;x&quot;)</f>');
    expect(blad).toContain('<mergeCell ref="A1:A2"/>');
    expect(blad).toContain('<formula>&quot;DG&quot;</formula>');
    expect(blad).toContain('state="frozen"');
    expect(bestanden.get('xl/workbook.xml')).toContain('<sheet name="Tweede"');
    expect(bestanden.get('xl/styles.xml')).toContain('FFED7D31');
  });
});

describe('jaarrooster in het eigen format', () => {
  it('het roosterjaar loopt van de maandag van week 1 tot de zondag van de laatste week', () => {
    const d = jaarDagen(2026);
    expect(d[0]).toBe('2025-12-29');
    expect(d[d.length - 1]).toBe('2027-01-03');
    expect(d.length).toBe(53 * 7);
    expect(jaarDagen(2027)[0]).toBe('2027-01-04');
  });

  it('codes zoals in de jaarroosters', () => {
    expect([exportCode('1', true), exportCode('2', true), exportCode('DG2', true), exportCode('-', true), exportCode('1M', true), exportCode('1B', true)]).toEqual([1, 2, 'DG', 'vrij', '1M', '1B']);
    // leeg: vrij in een maand waarvoor al gepland is, anders leeg
    expect(exportCode(undefined, true)).toBe('vrij');
    expect(exportCode(undefined, false)).toBeNull();
  });

  it('geen namen: in de volgorde van het rooster; bestaande codes blijven, de rest krijgt het volgende nummer', () => {
    const r = exportRijen([mw('a', 'Qwerty Een'), mw('b', 'AMS 03'), mw('c', 'AMS 01'), mw('d', 'NHN 07'), mw('e', 'Qwerty Zes'), mw('f', 'AMS 03')], 'AMS');
    expect(r.map((x) => [x.e.id, x.label])).toEqual([['a', 'AMS 04'], ['b', 'AMS 03'], ['c', 'AMS 01'], ['d', 'AMS 05'], ['e', 'AMS 06'], ['f', 'AMS 07']]);
  });

  it('de vastgestelde regelplekken met de weken waarin het verandert', () => {
    const d = jaarDagen(2026).slice(3, 3 + 7 * 52);
    expect(wijzigingenTekst(d, (x) => (x >= '2026-07-27' && x < '2026-09-21' ? 3 : 4))).toBe('4; vanaf wk 31 3; vanaf wk 39 4');
    expect(wijzigingenTekst(d, () => null)).toBe('');
  });

  const okt = isoRange('2026-10-01', '2026-10-31');
  const regio = (r: string, namen: string[]): ExportRegio => {
    const team = namen.map((n, i) => mw(`${r}${i}`, n, 32, { regio: r, afstandsverklaring: i === 0 }));
    const cellen = Object.fromEntries(team.map((e, i) => [e.id, Object.fromEntries(okt.map((d, k) => [d, (k + i) % 4 === 0 ? '1' : (k + i) % 4 === 1 ? 'DG2' : (k + i) % 4 === 2 ? '1M' : '-'] as const))]));
    return { regio: r, team, cellen, plekken: () => 4, status: (m) => (m === '2026-10' ? 'Definitief' : '') };
  };
  const namen = ['Qwerty Een', 'Qwerty Twee', 'Qwerty Drie'];
  const bladen = jaarroosterBladen(2026, [regio('Noord-Holland', namen), regio('Amsterdam', ['Qwerty Vier', 'Qwerty Vijf'])]);
  const nhn = bladen[0];
  const cel = (b: typeof nhn, r: number, c: number) => b.rijen.get(r)?.get(c)?.v;

  it('per regio een rooster en een urenblad, met de bladnamen uit de jaarroosters', () => {
    expect(bladen.map((b) => b.naam)).toEqual(['NHN', 'AMS', 'NHN uren', 'AMS uren']);
  });

  it('de kop: regelplekken, cluster, maanden, even en oneven weken, datum en weekdag', () => {
    expect(cel(nhn, 1, 1)).toBe('ingezet aantal regelplekken regio:');
    expect(cel(nhn, 2, 1)).toBe(4);
    expect(cel(nhn, 2, 2)).toEqual({ f: 'SUM(NHN!$A$2,AMS!$A$2)' });
    expect([cel(nhn, 6, 1), cel(nhn, 6, 2)]).toEqual(['mw', 'contract-uren']);
    expect([cel(nhn, 2, 3), cel(nhn, 2, 6)]).toEqual(['dec', 'JANUARI']);
    expect([cel(nhn, 3, 3), cel(nhn, 4, 3), cel(nhn, 3, 10), cel(nhn, 4, 10)]).toEqual(['ONEVEN', 'wk 1', 'EVEN', 'wk 2']);
    expect([cel(nhn, 5, 3), cel(nhn, 5, 6), cel(nhn, 6, 3), cel(nhn, 6, 6)]).toEqual([29, 1, 'ma', 'do']);
    // Definitief boven oktober
    const oktKol = [...nhn.rijen.get(2)!.entries()].find(([, c]) => c.v === 'OKTOBER')![0];
    expect(cel(nhn, 1, oktKol)).toBe('Definitief');
  });

  it('rijen zonder namen, met contract en de codes; leeg in maanden zonder rooster', () => {
    const alleTekst = bladen.flatMap((b) => [...b.rijen.values()].flatMap((r) => [...r.values()].map((c) => (typeof c.v === 'string' ? c.v : typeof c.v === 'object' && c.v ? c.v.f : ''))));
    for (const n of [...namen, 'Qwerty Vier', 'Qwerty Vijf']) expect(alleTekst.some((t) => t.includes(n))).toBe(false);
    expect([cel(nhn, 7, 1), cel(nhn, 7, 2), cel(nhn, 9, 1)]).toEqual(['NHN 01', 32, 'NHN 03']);
    const k1okt = 3 + 276; // 1 oktober: 276 dagen na 29 december
    expect(cel(nhn, 5, k1okt)).toBe(1);
    expect([cel(nhn, 7, k1okt), cel(nhn, 8, k1okt), cel(nhn, 9, k1okt), cel(nhn, 10, k1okt) ?? null]).toEqual([1, 'DG', '1M', null]);
    expect(cel(nhn, 7, k1okt + 3)).toBe('vrij');
    expect(cel(nhn, 7, 6) ?? null).toBeNull(); // januari: nog geen rooster
  });

  it('telregels, clusterregels, feestdagen- en weekendteller zoals in de jaarroosters', () => {
    expect(cel(nhn, 47, 1)).toBe('regelplekken gepland');
    expect(cel(nhn, 47, 3)).toEqual({ f: 'SUM(C7:C46)+COUNTIF(C7:C46,"1M")+COUNTIF(C7:C46,"1B")' });
    expect(cel(nhn, 57, 1)).toBe('Verlof (V)');
    expect(cel(nhn, 58, 1)).toBe('regelplekken gepland cluster');
    expect(cel(nhn, 58, 3)).toEqual({ f: 'SUM(NHN!C47,AMS!C47)' });
    const rij3 = [...nhn.rijen.get(3)!.entries()];
    const feest = rij3.find(([, c]) => c.v === 'Feestdagenteller')![0], weekend = rij3.find(([, c]) => c.v === 'Weekendteller')![0];
    expect(kol(feest)).toBe('NL');
    expect(cel(nhn, 4, feest + 3)).toBe('Koningsdag');
    expect(String((cel(nhn, 7, weekend + 1) as { f: string }).f)).toContain('="za")*ISNUMBER(MATCH(TRIM(UPPER(');
    expect(cel(nhn, 7, weekend + 3)).toBe('x'); // afstandsverklaring: ja
    expect(cel(nhn, 8, weekend + 4)).toBe('x'); // nee
    expect(nhn.regels.some((r) => r.formules[0] === '"DG"')).toBe(true);
    expect(nhn.regels.some((r) => r.bereik.startsWith('C47:') && r.formules[0] === '$A$2')).toBe(true);
  });

  it('het urenblad telt per maand de diensten en rekent de uren per week', () => {
    const u = bladen[2];
    expect(cel(u, 7, 1)).toEqual({ f: 'NHN!A7' });
    // een lege rij blijft leeg tot er in het rooster iemand bij komt
    expect(cel(u, 10, 1)).toEqual({ f: 'IF(NHN!$A10="","",NHN!A10)' });
    const okt0 = 3 + 9 * 16;
    expect(cel(u, 2, okt0)).toBe('oktober');
    expect(cel(u, 3, okt0 + 6)).toBe(1);
    expect(String((cel(u, 7, okt0 + 1) as { f: string }).f)).toMatch(/^COUNTIF\(NHN!\$[A-Z]+7:\$[A-Z]+7,"DG"\)/);
    expect(String((cel(u, 7, okt0 + 2) as { f: string }).f)).toContain('/(31/7)');
    expect(String((cel(u, 7, okt0 + 13) as { f: string }).f)).toMatch(/^IF\(AND\(NHN!\w+7="vrij",NHN!\w+7="vrij"\),0,1\)/);
  });
});
