"use client";

/**
 * Drop subscription (UX-05): review offer → check subscription → reserve and
 * confirm → wait for allocation → outcome. The server reserves the amount and
 * confirms; this component never decides price or eligibility.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeAction } from "@/app/(app)/uitgiftes/actions";

type Props = {
  dropId: string;
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
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [requestKey, setRequestKey] = useState("");
  const [alert, setAlert] = useState(false);

  if (!p.isOpen) {
    return (
      <div>
        <button type="button" onClick={() => setAlert(true)} aria-pressed={alert} className="w-full rounded-lg bg-primary py-3 font-semibold text-white">
          {alert ? "Melding ingesteld (demo)" : "Melding instellen"}
        </button>
        <p className="mt-1 text-xs text-muted">{alert ? "In de demo wordt de melding niet verstuurd; e-mail- en pushmeldingen volgen later." : `Inschrijving opent ${p.windowLabel}.`}</p>
      </div>
    );
  }

  async function confirm() {
    setBusy(true);
    try {
      const r = await subscribeAction(p.dropId, requestKey);
      setResult(r);
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" disabled={!p.canSubscribe} onClick={() => { setStep(1); setResult(null); setRequestKey(crypto.randomUUID()); ref.current?.showModal(); }} className="w-full rounded-lg bg-primary py-3 font-semibold text-white disabled:opacity-50">
        Inschrijven
      </button>
      {!p.canSubscribe && p.blockReason && <p className="mt-1 text-xs text-muted">{p.blockReason}</p>}
      <dialog ref={ref} onClose={() => { if (result?.ok) router.refresh(); }} aria-label="Inschrijving controleren" className="m-auto max-h-[90dvh] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-xl p-0 backdrop:bg-navy/50">
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
              <p className="text-muted">Je betaalt alleen bij toewijzing. Krijg je geen kaart, dan wordt de reservering vrijgegeven. Tot de sluiting kun je je afmelden.</p>
            </>
          )}
          {step === 3 && result && (
            <p role="status" className={`rounded-lg px-3 py-2 ${result.ok ? "bg-primary-soft" : "bg-danger-soft text-down"}`}>{result.message}</p>
          )}
          <div className="grid grid-cols-2 gap-3 pt-2">
            {step < 3 ? (
              <>
                <button type="button" onClick={() => (step === 1 ? ref.current?.close() : setStep(1))} className="rounded-lg border border-slate-300 py-2.5">
                  {step === 1 ? "Annuleren" : "Terug"}
                </button>
                <button type="button" disabled={busy} onClick={() => (step === 1 ? setStep(2) : confirm())} className="rounded-lg bg-primary py-2.5 font-semibold text-white disabled:opacity-50">
                  {step === 1 ? "Controleren" : "Bedrag reserveren en inschrijven"}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => ref.current?.close()} className="col-span-2 rounded-lg bg-primary py-2.5 font-semibold text-white">Sluiten</button>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
