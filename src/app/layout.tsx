import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "EOC Assist — Equal Opportunity Cell",
    template: "%s · EOC Assist",
  },
  description:
    "Equal Opportunity Cell workspace for HKBK College of Engineering — circular intake, routing, meetings, actions and compliance evidence.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="micro-note" role="contentinfo">
          EOC Assist · HKBK College of Engineering
        </footer>
      </body>
    </html>
  );
}
