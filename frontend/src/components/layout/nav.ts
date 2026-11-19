import {
  BarChart3,
  Gauge,
  Landmark,
  LayoutDashboard,
  Search,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { LinkProps } from "@tanstack/react-router";
import type { Role } from "@/types";

export interface NavItem {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: Record<Role, NavGroup[]> = {
  admin: [],
  cashier: [
    {
      label: "Overview",
      items: [{ to: "/cashier", label: "Dashboard", icon: LayoutDashboard, exact: true }],
    },
    {
      label: "Credit desk",
      items: [{ to: "/cashier/guests", label: "Guest Search", icon: Search }],
    },
  ],
  finance: [
    {
      label: "Overview",
      items: [{ to: "/finance", label: "Dashboard", icon: Gauge, exact: true }],
    },
    {
      label: "Accounts",
      items: [
        { to: "/finance/guests", label: "Accounts", icon: Users },
        { to: "/finance/historical", label: "Historical Debt", icon: Landmark },
      ],
    },
    {
      label: "Reports",
      items: [{ to: "/finance/reports", label: "Financial Reports", icon: BarChart3 }],
    },
  ],
  guest: [
    {
      label: "My account",
      items: [{ to: "/guest", label: "Dashboard", icon: LayoutDashboard, exact: true }],
    },
    {
      label: "Debt & payments",
      items: [{ to: "/guest/debt", label: "Debt Details", icon: Wallet }],
    },
  ],
};
