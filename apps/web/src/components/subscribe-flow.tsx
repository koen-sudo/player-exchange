"use client";

/**
 * Drop subscription (UX-05): review offer → check subscription → reserve and
 * confirm → wait for allocation → outcome. In this demo build step 3 explains
 * that the reservation service is not connected yet; nothing is reserved.
 */
import { useRef, useState } from "react";

type Props = {
  playerName: string;
  priceLabel: string;
  quantity: number;
  maxPerUser: number;
  windowLabel: string;
  isOpen: boolean;
  canSubscribe: boolean;
  blockReason: string | null;
};

export function SubscribeFlow(p: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [alert, setAlert] = useState(false);

  if (!p.isOpen) {
    return (
      <div>
        <button type="button" onClick={() => setAlert(true)} aria-pressed={alert} className="w-full rounded-lg bg-primary py-3 font-semibold text-white">
          {alert ? "Melding ingesteld (demo)" : "Melding instellen"}
        </button>
        <p className="mt-1 text-xs text-muted">{alert ? "In de demo wordt de melding niet verstuurd; meldingen worden in een volgende fase aangesloten." : `Inschrijving opent ${p.windowLabel}.`}</p>
      </div>
    );
  }

  return (
    <div>
      <button type="button" disabled={!p.canSubscribe} onClick={() => { setStep(1); ref.current?.showModal(); }} className="w-full rounded-lg bg-primary py-3 font-semibold text-white disabled:opacity-50">
        Inschrijven
      </button>
      {!p.canSubscribe && p.blockReason && <p className="mt-1 text-xs text-muted">{p.blockReason}</p>}
      <dialog ref={ref} aria-label="Inschrijving controleren" className="m-auto max-h-[90dvh] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-xl p-0">
        <div className="bg-navy px-4 py-3 font-semibold text-white">Stap {step} van 3 · Inschrijving</div>
        <div className="space-y-3 p-4 text-sm">
          {step === 1 && (
            <>
              <p className="font-semibold">{p.playerName}</p>
              <p>{p.quantity} kaarten tegen {p.priceLabel} per kaart, maximaal {p.maxPerUser} per persoon.</p>
              <p className="text-muted">Bij meer inschrijvingen dan kaarten worden kaarten willekeurig toegewezen via een vooraf vastgelegde, controleerbare trekking.</p>
            </>
          )}
          {step === 2 && (
            <>
              <p>Bij bevestiging wordt <strong className="num">{p.priceLabel}</strong> van je beschikbare saldo gereserveerd.</p>
              <p className="text-muted">Je betaalt alleen bij toewijzing. Krijg je geen kaart, dan wordt de reservering vrijgegeven.</p>
            </>
          )}
          {step === 3 && (
            <p role="status" className="rounded-lg bg-warn-soft px-3 py-2">Demo: er is niets gereserveerd en je bent niet ingeschreven. De reservering en toewijzing worden in fase 6 aangesloten.</p>
          )}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button type="button" onClick={() => (step === 1 ? ref.current?.close() : setStep((s) => (s - 1) as 1 | 2))} className="rounded-lg border border-slate-300 py-2.5">
              {step === 1 ? "Annuleren" : "Terug"}
            </button>
            {step < 3 ? (
              <button type="button" onClick={() => setStep((s) => (s + 1) as 2 | 3)} className="rounded-lg bg-primary py-2.5 font-semibold text-white">
                {step === 1 ? "Controleren" : "Bedrag reserveren en inschrijven"}
              </button>
            ) : (
              <button type="button" onClick={() => ref.current?.close()} className="rounded-lg bg-primary py-2.5 font-semibold text-white">Sluiten</button>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
