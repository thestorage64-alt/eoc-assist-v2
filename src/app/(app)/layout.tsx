import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import Shell, { type NavItem } from "@/components/Shell";
import { actorFromSession } from "./actor";

export const dynamic = "force-dynamic";

/**
 * Nav items. Capability rules:
 *  - principal sees everything, read-only (no composer buttons on pages);
 *  - member sees their own work (no reports);
 */
function navFor(role: string): NavItem[] {
  const items: (NavItem & { roles?: string[] })[] = [
    { href: "/command", label: "Command centre", icon: "grid" },
    { href: "/circulars", label: "Circulars", icon: "inbox" },
    { href: "/workflow", label: "Workflow", icon: "flow" },
    { href: "/cells", label: "Cells", icon: "people" },
    { href: "/reports", label: "Reports", icon: "chart", roles: ["principal", "chair", "head"] },
  ];
  return items.filter((i) => !i.roles || i.roles.includes(role));
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await actorFromSession();
  if (!actor) redirect("/login");

  const { user } = actor;
  return (
    <Shell
      user={{
        name: user.name,
        designation: user.designation,
        email: user.email,
        role: user.role,
      }}
      nav={navFor(user.role)}
    >
      {children}
    </Shell>
  );
}
