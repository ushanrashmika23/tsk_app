import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";

import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Task & Schedule",
  description: "Simple task and schedule management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className={`${inter.className} h-screen flex flex-col md:flex-row bg-gray-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 overflow-hidden transition-colors duration-200`}>
        <Providers>
          {/* Desktop Sidebar */}
        <div className="hidden md:flex flex-col w-64 border-r border-gray-200 dark:border-zinc-800 p-4 shrink-0 h-full overflow-y-auto">
          <div className="font-semibold text-lg mb-8 px-2">Tasks & Schedule</div>
          <Navigation />
        </div>

        {/* Main Content Area (Scrolling) */}
        <div className="flex-1 w-full h-full overflow-y-auto scroll-smooth custom-scrollbar">
          <main className="w-full max-w-3xl mx-auto px-4 py-6 pb-24 md:pb-6 min-h-full">
            {children}
          </main>
        </div>

        {/* Mobile Bottom Navigation */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-800 pb-safe">
          <Navigation mobile />
        </div>
        </Providers>
      </body>
    </html>
  );
}
