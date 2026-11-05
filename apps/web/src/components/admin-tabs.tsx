"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminTabs({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Beheer" className="mb-5 flex flex-wrap gap-2">
      {links.map(({ href, label }) => {
        const active = href === "/beheer" ? path === "/beheer" : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm ${active ? "border-primary bg-primary text-white" : "border-line bg-white hover:border-primary"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
