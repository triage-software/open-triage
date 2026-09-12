// One-off: populate the local prototype demo with a few sample emails through
// the same ingestion path the IMAP sync uses (saveMailSync -> mergeIncomingMail).
// Usage: node --import ./scripts/seed-register.mjs scripts/seed-demo-mail.mjs
import { saveMailSync } from "../src/lib/store.ts";

const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();

const messages = [
  {
    subject: "Zmiana adresu dostawy w zamówieniu #4482",
    email: {
      id: "demo-seed-1",
      direction: "inbound",
      authorName: "Marta Kowalczyk",
      from: "marta.kowalczyk@example.com",
      to: "support@example.com",
      body: "Dzień dobry, czy mogę jeszcze zmienić adres dostawy w zamówieniu #4482? Paczka ma iść teraz do biura w Poznaniu. Z góry dziękuję za pomoc.",
      createdAt: iso(23),
      demo: true,
      messageId: "<demo-seed-1@example.com>",
    },
  },
  {
    subject: "Faktura VAT z błędnym numerem NIP",
    email: {
      id: "demo-seed-2",
      direction: "inbound",
      authorName: "Piotr Zieliński",
      from: "piotr.zielinski@firma-example.pl",
      to: "support@example.com",
      body: "Witajcie, na fakturze do zamówienia #4401 widnieje błędny NIP (powinno być 779-24-56-789). Proszę o korektę i przesłanie poprawionej wersji.",
      createdAt: iso(95),
      demo: true,
      messageId: "<demo-seed-2@example.com>",
    },
  },
  {
    subject: "Nie mogę zalogować się do panelu po zmianie hasła",
    email: {
      id: "demo-seed-3",
      direction: "inbound",
      authorName: "Anna Lis",
      from: "anna.lis@example.eu",
      to: "support@example.com",
      body: "Cześć, po wczorajszej zmianie hasła nie mogę wejść do panelu. Reset hasła nie przychodzi na maila (sprawdzałam też spam). Co mogę zrobić?",
      createdAt: iso(8),
      demo: true,
      messageId: "<demo-seed-3@example.com>",
    },
  },
];

const imported = await saveMailSync({ status: "unconfigured" }, messages);
console.log("imported:", imported);
process.exit(0);
