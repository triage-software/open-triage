import type { Metadata } from "next";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "./globals.css";
import "../styles/mvp.css";

export const metadata: Metadata = {
  title: "Open Triage",
  description: "Shared-inbox triage for teams. Self-hostable, AI-assisted.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script src="/api/dev/react-grab" strategy="beforeInteractive" />
        )}
      </head>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
