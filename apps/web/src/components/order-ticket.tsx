"use client";

/**
 * Order ticket (UX-02 trade panel, UX-06, UX-07, WF-02).
 *
 * The panel button is "Controleer kooporder"/"Controleer verkooporder". It asks
 * the server for a preview and opens the review dialog. Only the dialog has
 * "Kooporder plaatsen"/"Verkooporder plaatsen". Totals shown in the dialog
 * come from the server, never from this component.
 */
import { useId, useRef, useState } from "react";
import { euroFromMinor, euroInputToMinor, dateTime } from "@/lib/format";

type Side = "BUY" | "SELL";
type Tif = "ONE_DAY" | "SEVEN_DAYS" | "THIRTY_DAYS";
const TIF_LABELS: Record<Tif, string> = { ONE_DAY: "1 dag", SEVEN_DAYS: "7 dagen", THIRTY_DAYS: "30 dagen" };

type Preview = Record<string, unknown> & {
  side: Side;
  quantity: number;
  limitPriceMinor: string;
  timeInForce: Tif;
  validUntil: string;
  expiresAtIfAcceptedNow: string;
};

export type OrderTicketProps = {
  playerId: string;
  playerName: string;
  bestBidMinor: string | null;
  bestAskMinor: string | null;
  freeCards: number;
  canTrade: boolean;
  blockReason: string | null;
  defaultSide?: Side;
};

export function OrderTicket(props: OrderTicketProps) {
  const [side, setSide] = useState<Side>(props.defaultSide ?? "BUY");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState(() => {
    const m = (props.defaultSide ?? "BUY") === "BUY" ? props.bestAskMinor : props.bestBidMinor;
    return m ? (Number(m) / 100).toFixed(2).replace(".", ",") : "";
  });
  const [tif, setTif] = useState<Tif>("SEVEN_DAYS");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = useId();

  const limitMinor = euroInputToMinor(price);
  const qtyNum = /^\d{1,3}$/.test(qty) ? Number(qty) : NaN;
  const indicative = limitMinor && Number.isInteger(qtyNum) && qtyNum > 0 ? String(Number(limitMinor) * qtyNum) : null;

  async function review() {
    setError(null);
    setResult(null);
    if (!limitMinor) return setError("Vul een geldige prijs in, bijvoorbeeld 6,20.");
    if (!Number.isInteger(qtyNum) || qtyNum < 1) return setError("Vul een geldig aantal hele kaarten in.");
    const res = await fetch("/api/v1/order-previews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side, playerId: props.playerId, quantity: qtyNum, limitPriceMinor: limitMinor, timeInForce: tif, cardIds: side === "SELL" ? "AUTO_OLDEST" : undefined }),
    });
    const body = (await res.json().catch(() => null)) as { data?: Preview; message?: string } | null;
    if (!res.ok || !body?.data) return setError(body?.message ?? "De controle is tijdelijk niet beschikbaar. Probeer het opnieuw.");
    setPreview(body.data);
    dialogRef.current?.showModal();
  }

  async function place() {
    if (!preview) return;
    if (new Date(preview.validUntil).getTime() < Date.now()) {
      setResult("De controle is verlopen. Open het controlevenster opnieuw.");
      return;
    }
    setPlacing(true);
    try {
      const res = await fetch("/api/v1/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": String(preview.previewId) },
        body: JSON.stringify({ previewId: preview.previewId }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setResult(body?.message ?? "Er ging iets mis. Er is niets geplaatst.");
    } finally {
      setPlacing(false);
    }
  }

  const label = side === "BUY" ? "kooporder" : "verkooporder";
  const sideTab = (s: Side, text: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={side === s}
      onClick={() => {
        setSide(s);
        const m = s === "BUY" ? props.bestAskMinor : props.bestBidMinor;
        if (m) setPrice((Number(m) / 100).toFixed(2).replace(".", ","));
      }}
      className={`flex-1 rounded-md py-2 font-semibold ${side === s ? "bg-primary text-white" : "text-ink"}`}
    >
      {text}
    </button>
  );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Kopen of verkopen" className="flex rounded-lg border border-line bg-slate-50 p-1">
        {sideTab("BUY", "Kopen")}
        {sideTab("SELL", "Verkopen")}
      </div>

      <div className="flex items-center justify-between rounded-lg bg-primary-soft px-3 py-2">
        <span className="text-sm">{side === "BUY" ? "Laagste vraag" : "Hoogste bod"}</span>
        <span className="num text-lg font-semibold">
          {side === "BUY" ? (props.bestAskMinor ? euroFromMinor(props.bestAskMinor) : "Geen actuele vraag") : props.bestBidMinor ? euroFromMinor(props.bestBidMinor) : "Geen actueel bod"}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_9rem] items-center gap-x-3 gap-y-2 text-sm">
        <label htmlFor={`${ids}-q`}>Aantal</label>
        <input id={`${ids}-q`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className="num rounded-lg border border-line px-3 py-2" />
        <label htmlFor={`${ids}-p`}>{side === "BUY" ? "Maximale prijs per kaart" : "Minimale prijs per kaart"}</label>
        <input id={`${ids}-p`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" className="num rounded-lg border border-line px-3 py-2" />
        <label htmlFor={`${ids}-t`}>Orderduur</label>
        <select id={`${ids}-t`} value={tif} onChange={(e) => setTif(e.target.value as Tif)} className="rounded-lg border border-line px-3 py-2">
          {(Object.keys(TIF_LABELS) as Tif[]).map((t) => (
            <option key={t} value={t}>{TIF_LABELS[t]}</option>
          ))}
        </select>
        <span>{side === "BUY" ? "Totaal (indicatie)" : "Bruto (indicatie)"}</span>
        <span className="num rounded-lg bg-slate-50 px-3 py-2">{indicative ? euroFromMinor(indicative) : "Niet beschikbaar"}</span>
      </div>

      {side === "SELL" && <p className="text-xs text-muted">Vrij te verkopen: {props.freeCards} {props.freeCards === 1 ? "kaart" : "kaarten"}. Het systeem kiest je oudste vrije kaarten; je ziet welke in de controle.</p>}

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-down">{error}</p>}

      <button type="button" onClick={review} disabled={!props.canTrade} className="w-full rounded-lg bg-primary py-3 font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50">
        Controleer {label}
      </button>
      {!props.canTrade && props.blockReason && <p className="text-xs text-muted">{props.blockReason}</p>}

      <dialog ref={dialogRef} aria-labelledby={`${ids}-dt`} className="m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl p-0 backdrop:bg-navy/50">
        {preview && (
          <div>
            <div className="flex items-center justify-between bg-navy px-4 py-3 text-white">
              <h2 id={`${ids}-dt`} className="font-semibold">{preview.side === "BUY" ? "Kooporder controleren" : "Verkooporder controleren"}</h2>
              <button type="button" aria-label="Sluiten" onClick={() => dialogRef.current?.close()} className="px-2 text-xl">×</button>
            </div>
            <div className="space-y-4 p-4">
              <p className="font-semibold">{props.playerName}</p>
              <dl className="divide-y divide-line rounded-lg border border-line text-sm">
                <Row k="Aantal" v={`${preview.quantity} ${preview.quantity === 1 ? "kaart" : "kaarten"}`} />
                <Row k={preview.side === "BUY" ? "Maximale prijs per kaart" : "Minimale prijs per kaart"} v={euroFromMinor(preview.limitPriceMinor)} />
                <Row k="Orderduur" v={TIF_LABELS[preview.timeInForce]} />
                <Row k="Verloopt bij plaatsing nu" v={dateTime(preview.expiresAtIfAcceptedNow)} />
                {preview.side === "BUY" ? (
                  <>
                    <Row k="Beste verkoopprijs nu" v={preview.bestAskMinor ? euroFromMinor(String(preview.bestAskMinor)) : "Geen actuele vraag"} />
                    <Row k="Maximaal te reserveren" v={euroFromMinor(String(preview.maxReserveMinor))} strong />
                  </>
                ) : (
                  <>
                    <Row k="Kaarten" v={(preview.cards as { serial: number; edition: string }[]).map((c) => `#${c.serial} (${c.edition})`).join(", ")} />
                    <Row k="Bruto bij volledige uitvoering" v={euroFromMinor(String(preview.grossAtLimitMinor))} />
                    <Row k="Commissie (5%)" v={euroFromMinor(String(preview.commissionMinor))} />
                    <Row k="Netto bij uitvoering" v={euroFromMinor(String(preview.netAtLimitMinor))} strong />
                  </>
                )}
              </dl>
              <p className="text-sm text-muted">{String(preview.side === "BUY" ? preview.partialFillNote : preview.roundingNote)}</p>
              <p className="text-sm text-muted">
                {preview.side === "BUY" ? "Plaatsing is nog geen aankoop. Uitvoering zodra een passende verkooporder beschikbaar is." : "Plaatsing is nog geen verkoop. Uitvoering zodra een koper jouw prijs accepteert."}
              </p>
              {result && <p role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-sm">{result}</p>}
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => dialogRef.current?.close()} className="rounded-lg border border-slate-300 py-2.5 font-medium">Terug</button>
                <button type="button" onClick={place} disabled={placing} className="rounded-lg bg-primary py-2.5 font-semibold text-white disabled:opacity-50">
                  {preview.side === "BUY" ? "Kooporder plaatsen" : "Verkooporder plaatsen"}
                </button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 px-3 py-2 ${strong ? "bg-primary-soft font-semibold" : ""}`}>
      <dt>{k}</dt>
      <dd className="text-right tabular-nums">{v}</dd>
    </div>
  );
}
