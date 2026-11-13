'use client';
import { useState } from 'react';
import { Thermometer } from 'lucide-react';
import { Modal, Veld } from '@/components/ui';
import type { Medewerker } from '@/lib/rooster/types';

export function ZiekModal({ open, onClose, team, vandaag, onMeld }: { open: boolean; onClose: () => void; team: Medewerker[]; vandaag: string; onMeld: (mid: string, van: string, tot: string) => void }) {
  const [mid, setMid] = useState('');
  const [van, setVan] = useState(vandaag);
  const [tot, setTot] = useState(vandaag);
  return (
    <Modal open={open} onClose={onClose} titel="Ziekmelding" voet={<>
      <button type="button" className="btn btn-ghost" onClick={onClose}>Annuleren</button>
      <button type="button" className="btn" disabled={!mid || tot < van} onClick={() => onMeld(mid, van, tot)}><Thermometer size={16} /> Ziek melden</button>
    </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Veld label="Medewerker" className="sm:col-span-2">
          <select className="input" value={mid} onChange={(e) => setMid(e.target.value)}>
            <option value="">Kies een medewerker</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
          </select>
        </Veld>
        <Veld label="Vanaf"><input className="input" type="date" value={van} onChange={(e) => { setVan(e.target.value); if (tot < e.target.value) setTot(e.target.value); }} /></Veld>
        <Veld label="Tot en met (verwacht)"><input className="input" type="date" min={van} value={tot} onChange={(e) => setTot(e.target.value)} /></Veld>
        <p className="note sm:col-span-2">De diensten in deze periode worden Z. Daarna zie je bij elke dag hoe je het opvangt. Bij herstel komen de diensten terug.</p>
      </div>
    </Modal>
  );
}
