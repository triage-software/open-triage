import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Triage · Wspólna skrzynka",
  description:
    "Lokalne demo zespołowej obsługi maili. Trzy skrzynki, jeden spokojniejszy dzień.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl">
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script src="/api/dev/react-grab" strategy="beforeInteractive" />
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
