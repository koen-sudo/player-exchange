// Simple line icons (no external icon set, no brand marks).
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const S = (d: string) =>
  function Icon({ className = "h-5 w-5" }: { className?: string }) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden {...P}>
        <path d={d} />
      </svg>
    );
  };

export const IconHome = S("M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z");
export const IconMarket = S("M3 17l6-6 4 4 8-8M15 7h6v6");
export const IconLayers = S("M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5");
export const IconWallet = S("M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2-3h12M16 13h2");
export const IconSwap = S("M4 8h14l-3-3M20 16H6l3 3");
export const IconUser = S("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0");
export const IconBell = S("M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0");
export const IconSearch = S("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5");
export const IconShield = S("M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z");
export const IconCard = S("M3 6h18v12H3zM3 10h18");

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-extrabold tracking-tight text-white">
      <span className="text-2xl italic">PX</span>
      <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-400" aria-hidden {...P}>
        <path d="M4 8h14l-3-3M20 16H6l3 3" />
      </svg>
      <span className="hidden text-lg font-bold tracking-wide sm:inline">PLAYER EXCHANGE</span>
    </span>
  );
}
