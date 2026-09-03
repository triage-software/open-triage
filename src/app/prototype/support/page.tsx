import { Suspense } from "react";
import { SupportApp } from "@/components/support-app";
export default function Page() {
  return (
    <Suspense
      fallback={<div className="boot-screen">Otwieramy wspólną skrzynkę…</div>}
    >
      <SupportApp />
    </Suspense>
  );
}
