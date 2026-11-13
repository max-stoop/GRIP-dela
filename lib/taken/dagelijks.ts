/**
 * De dagelijkse voorspelling op de server, elke ochtend. De database legt in één handeling vast wie de taak doet
 * (rp_dagtaak_claim): starten er twee tegelijk, dan doet er één niets. Alles wat de taak schrijft, gaat in één
 * transactie en alleen zolang de taak nog van deze uitvoering is.
 */
import type { Db } from '../store/db/db';
import { conflictTabel, databaseBijgewerkt, voerUit } from '../store/db/db';
import { laadDelenVeilig } from '../store/db/laden';
import { TABELLEN, type Rij } from '../store/db/tabellen';
import { verschil } from '../store/db/verschil';
import type { AppState, BronStatus, Dagtaak } from '../store/types';
import type { FactorKey } from '../model/config';
import { voerUit as reken } from '../model/werk';
import { runsBijwerken, uniekRunId, voegExternToe, type BronAntwoord } from '../model/bijhouden';
import { DAGELIJKSE_BRONNEN } from '../bronnen/haal';
import { bronGebreken, gebrekTekst } from '../bronnen/actualiteit';
import type { BronNaam } from '../bronnen/common';
import { dagtaakOverslaan, OPNIEUW_NA_MINUTEN } from './status';
import { uitNederlandseTijd } from '../dates';

export interface DagtaakOpties {
  vandaag: string;
  /** Nederlandse tijd, "2026-10-18T06:00:12". */
  nu: () => string;
  haal: (bron: BronNaam) => Promise<BronAntwoord>;
  /** Minuten; daarna mag een nieuwe poging. */
  looptijd?: number;
}

type DagtaakUitkomst = Dagtaak & { overgeslagen?: string };

const DEFS = TABELLEN.filter((t) => ['rp_extern', 'rp_bron_status', 'rp_run', 'rp_activiteit'].includes(t.naam));

export async function leesDagtaak(db: Db): Promise<Dagtaak | null> {
  const [r] = await db.lees('rp_instelling', { filters: [{ kolom: 'sleutel', op: 'eq', waarde: 'dagtaak' }] });
  return r?.waarde && typeof r.waarde === 'object' ? (r.waarde as Dagtaak) : null;
}

/** De rij moet nog de versie van de claim hebben. */
const vanClaim = (claim: number) => (tabel: string, rij: Rij) => (tabel === 'rp_instelling' && rij.sleutel === 'dagtaak' ? claim : undefined);

export async function voerDagtaakUit(db: Db, o: DagtaakOpties): Promise<DagtaakUitkomst> {
  const looptijd = o.looptijd ?? 20;
  const huidig = await leesDagtaak(db);
  const niet = dagtaakOverslaan(huidig, o.vandaag, o.nu(), looptijd);
  if (niet && huidig) return { ...huidig, overgeslagen: niet };
  const start: Dagtaak = { datum: o.vandaag, status: 'gestart', gestart: o.nu(), waar: 'server' };
  if (!await databaseBijgewerkt(db)) return { ...start, status: 'mislukt', klaar: o.nu(), melding: 'De database moet eerst worden bijgewerkt' };
  const [geclaimd] = await db.rpc('rp_dagtaak_claim', { p_status: start, p_looptijd: looptijd });
  const claim = Number(geclaimd?.versie);
  if (!claim) return { ...(await leesDagtaak(db) ?? start), overgeslagen: 'Een andere uitvoering is bezig of klaar' };
  try {
    const { staat, mislukt } = await laadDelenVeilig(db, o.vandaag, ['instellingen', 'meldingen', 'extern', 'handmatig', 'coef', 'runs', 'bronStatus']);
    if (mislukt.length) throw new Error(`Niet alles kon worden gelezen (${mislukt.map((m) => m.deel).join(', ')})`);

    // de bronnen: een fout bij de een blokkeert de andere niet
    let extern = staat.extern ?? {};
    let normaal = staat.normaal ?? null;
    const bronStatus: Record<string, BronStatus> = { ...(staat.bronStatus ?? {}) };
    const lijst: [BronNaam, string][] = [...DAGELIJKSE_BRONNEN.map(([n, opslag]) => [n, opslag] as [BronNaam, string]), ...(normaal ? [] : [['normalen', 'normalen'] as [BronNaam, string]])];
    let ok = 0;
    const opgehaald: Record<string, boolean> = {};
    for (const [naam, opslag] of lijst) {
      const st: BronStatus = { bron: naam, opgehaald: o.nu(), ok: false, melding: '', rijen: 0 };
      try {
        const res = await o.haal(naam);
        if (res.normaal) normaal = res.normaal;
        if (res.reeksen.length) extern = voegExternToe(extern, opslag, res);
        st.ok = true;
        st.rijen = res.rijen;
        ok++;
      } catch (e) {
        st.melding = e instanceof Error ? e.message : String(e);
      }
      bronStatus[naam] = st;
      opgehaald[opslag] = st.ok;
    }
    const gebreken = bronGebreken({ extern, opgehaald, vandaag: o.vandaag, normaal: !!normaal });

    // bewaartermijnen (AVG): wat langer staat dan nodig, gaat weg; een fout hier houdt de voorspelling niet tegen
    let opgeruimd: Record<string, number> | string;
    try {
      opgeruimd = Object.fromEntries((await db.rpc('rp_opruimen', { p_vandaag: o.vandaag })).map((r) => [String(r.tabel), Number(r.weg)]).filter(([, n]) => Number(n) > 0));
    } catch (e) {
      opgeruimd = `mislukt: ${e instanceof Error ? e.message : String(e)}`;
      console.error('Opruimen', e);
    }

    let runs = staat.runs ?? [];
    let nieuweRuns: { meta: AppState['runs'][number]; data: unknown }[] = [];
    let runId: string | undefined;
    if (staat.meldingen) {
      // een nieuwe poging vandaag vervangt de dagelijkse run van eerder vandaag (behalve als die de roosterbasis is)
      runs = runs.filter((r) => !(r.soort === 'dagelijks' && r.uitgegeven === o.vandaag && r.id !== staat.roosterbasis?.runId));
      runId = uniekRunId(o.vandaag, runs, o.nu());
      const coef = Object.fromEntries(Object.entries(staat.coef ?? {}).map(([k, c]) => [k, c!.waarde])) as Partial<Record<FactorKey, number>>;
      const a = reken({ type: 'runs', input: { meldingen: staat.meldingen, extern, handmatig: staat.handmatig ?? [], coef, normaal }, uitgaven: [{ issue: o.vandaag, soort: 'dagelijks', id: runId }] });
      if (a.type !== 'runs') throw new Error('Het rekenen is niet gelukt');
      nieuweRuns = a.runs;
      runs = runsBijwerken(runs, a.runs, staat.roosterbasis?.runId).alle;
    }

    // niet bereikbaar is vaak een storing: dan straks nog een poging (de Logic App komt elk uur tot 12:00)
    const opnieuwNa = gebreken.length && ok < lijst.length ? new Date(uitNederlandseTijd(o.nu()).getTime() + OPNIEUW_NA_MINUTEN * 60_000).toISOString() : undefined;
    const klaar: Dagtaak = {
      ...start, status: gebreken.length ? 'beperkt' : 'geslaagd', klaar: o.nu(), bronnen: { ok, fout: lijst.length - ok }, ...(opnieuwNa ? { opnieuwNa } : {}),
      ...(gebreken.length ? { gebreken } : {}), ...(runId ? { run: runId } : {}), opgeruimd,
    };
    const tekst = `Dagelijkse voorspelling (server): bronnen ${ok} van ${lijst.length} gelukt${runId ? ', nieuwe voorspelling gemaakt' : ', nog geen meldingen'}`
      + (gebreken.length ? `; met verouderde of ontbrekende bronnen: ${gebreken.map((g) => gebrekTekst(g, (d) => d)).join('; ')}` : '; alle bronnen actueel')
      + (typeof opgeruimd === 'string' ? `; opruimen (bewaartermijnen) ${opgeruimd}` : Object.keys(opgeruimd).length ? `; opgeruimd volgens de bewaartermijnen: ${Object.values(opgeruimd).reduce((a, n) => a + n, 0)} regels` : '');
    const oud = { extern: staat.extern ?? {}, bronStatus: staat.bronStatus ?? {}, runs: staat.runs ?? [], activiteit: [] } as unknown as AppState;
    const nieuw = { extern, bronStatus, runs, activiteit: [{ id: crypto.randomUUID(), moment: o.nu(), soort: 'model', tekst }] } as unknown as AppState;
    const ops = verschil(oud, nieuw, 'beheerder', DEFS);
    const instellingen = [{ sleutel: 'dagtaak', waarde: klaar }, { sleutel: 'laatsteAuto', waarde: o.vandaag }, ...(normaal && !staat.normaal ? [{ sleutel: 'normaal', waarde: normaal }] : [])];
    ops.push({ tabel: 'rp_instelling', soort: 'upsert', rijen: instellingen, nieuw: instellingen.map(() => false) });
    const data = new Map(nieuweRuns.map((r) => [r.meta.id, r.data]));
    await voerUit(db, ops, { rol: 'beheerder', aanvullen: (t, r) => (t === 'rp_run' ? { ...r, data: data.get(String(r.id)) ?? null } : r), controle: vanClaim(claim) });
    return klaar;
  } catch (e) {
    // de taak is intussen van een andere uitvoering (deze duurde langer dan de looptijd): die gaat verder, hier niets
    if (conflictTabel(e) === 'rp_instelling') return { ...start, overgeslagen: 'Een andere uitvoering heeft de taak overgenomen' };
    const fout: Dagtaak = { ...start, status: 'mislukt', klaar: o.nu(), melding: e instanceof Error ? e.message : String(e) };
    await voerUit(db, [{ tabel: 'rp_instelling', soort: 'upsert', rijen: [{ sleutel: 'dagtaak', waarde: fout }], nieuw: [false] }], { rol: 'beheerder', controle: vanClaim(claim) })
      .catch((x) => console.error('Status dagelijkse voorspelling', x));
    return fout;
  }
}
