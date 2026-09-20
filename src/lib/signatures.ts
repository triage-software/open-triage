import type { EmployeeSignature, User } from "./types";

export const companyLegal = "Open Triage · opentriage.com";

export const employeeSignatures: Record<string, EmployeeSignature> = {
  anna: {
    name: "Anna Nowak",
    title: "Finanse i administracja",
    email: "anna.nowak@opentriage.com",
    website: "opentriage.com",
    company: "Open Triage",
  },
  jan: {
    name: "Jan Kowalski",
    title: "CEO",
    email: "jan.kowalski@opentriage.com",
    website: "opentriage.com",
    company: "Open Triage",
  },
  michal: {
    name: "Michał Kluska",
    title: "Zespół wsparcia",
    email: "michal.kluska@opentriage.com",
    website: "opentriage.com",
    company: "Open Triage",
  },
};

export function signatureFor(user: Pick<User, "id" | "name" | "role" | "signature">, mailboxEmail: string): EmployeeSignature {
  return structuredClone(user.signature ?? employeeSignatures[user.id] ?? {
    name: user.name,
    title: user.role,
    email: mailboxEmail,
    website: "opentriage.com",
    company: "Open Triage",
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
