"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, CheckSquare, Settings, Sun } from "lucide-react";

export default function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Today", icon: Sun },
    { href: "/tasks", label: "Tasks", icon: CheckSquare },
    { href: "/schedule", label: "Schedule", icon: Calendar },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  if (mobile) {
    return (
      <nav className="flex justify-around items-center p-3">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-colors ${
                isActive
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
              }`}
            >
              <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-medium">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-2">
      {links.map((link) => {
        const Icon = link.icon;
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
              isActive
                ? "bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm font-medium"
                : "text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800/50"
            }`}
          >
            <Icon size={20} />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
