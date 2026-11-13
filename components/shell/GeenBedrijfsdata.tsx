/** Bovenaan elke pagina: deze versie draait zonder bedrijfsdata, en op test staat erbij dat het test is. */
export function GeenBedrijfsdata({ omgeving }: { omgeving?: string | null }) {
  const test = omgeving === 'test';
  // test in vaste kleuren: in het lichte en het donkere thema even goed te lezen en niet te missen
  const kleur = test ? 'border-transparent bg-[#f2c14e] text-[#2b1d00]' : 'border-line bg-soft text-muted';
  return (
    <div className={`geen-print border-b px-4 py-1.5 text-center text-[13px] font-semibold ${kleur}`} role="note">
      {test && 'Testomgeving · '}Deze versie bevat geen bedrijfsdata.
    </div>
  );
}
