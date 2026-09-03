import type { EmployeeSignature, User } from "./types";

export const companyLegal = "Open Triage · opentriage.com";

export const employeeSignatures: Record<string, EmployeeSignature> = {
  anna: {
    name: "Anna Nowak",
    title: "Kierownik Działu Administracji i Finansów",
    phone: "",
    email: "anna.nowak@opentriage.com",
    website: "www.opentriage.com",
    company: "Open Triage",
  },
  jan: {
    name: "Jan Kowalski",
    title: "CEO | Prezes Zarządu",
    phone: "",
    email: "jan.kowalski@opentriage.com",
    website: "www.opentriage.com",
    company: "Open Triage",
  },
  michal: {
    name: "Michał Kluska",
    title: "Zespół wsparcia Open Triage",
    email: "support@example.com",
    website: "www.opentriage.com",
    company: "Open Triage · Open Triage",
  },
};

export function signatureFor(user: Pick<User, "id" | "name" | "role" | "signature">, mailboxEmail: string): EmployeeSignature {
  return structuredClone(user.signature ?? employeeSignatures[user.id] ?? {
    name: user.name,
    title: user.role,
    email: mailboxEmail,
    website: "www.opentriage.com",
    company: "Open Triage · Open Triage",
  });
}

export function signatureText(signature: EmployeeSignature) {
  if (signature.custom) return signature.custom.text;
  return [
    "Pozdrawiam,", signature.name, signature.title,
    ...(signature.phone ? [`☎ ${signature.phone}`] : []),
    `✉ ${signature.email}`, `🌐 ${signature.website}`, "", companyLegal,
  ].join("\n");
}
