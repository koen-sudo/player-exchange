"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, children, variant }: { href: string; children: ReactNode; variant: "side" | "bottom" }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`) || (href === "/markt" && path.startsWith("/spelers"));
  const base =
    variant === "side"
      ? "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] text-white/85 hover:bg-white/10"
      : "flex flex-1 flex-col items-center gap-1 py-2 text-xs text-muted";
  const on = variant === "side" ? "bg-primary text-white" : "text-primary font-semibold";
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${base} ${active ? on : ""}`}>
      {children}
    </Link>
  );
}
