import type { EmployeeSignature, User } from "./types";

export const companyLegal = "Pryzmat Media Spółka z ograniczoną odpowiedzialnością, ul. Wiśniowa 4/58, 21-040 Świdnik, KRS: 0000938584, NIP: 7123427969, REGON: 520664588, kapitał zakładowy: 5 000 zł.";

export const employeeSignatures: Record<string, EmployeeSignature> = {
  irena: {
    name: "Irena Bronkowska-Mika",
    title: "Kierownik Działu Administracji i Finansów",
    phone: "+48 729 921 970",
    email: "irena.bronkowska@pryzmat.media",
    website: "www.pryzmat.media",
    company: "Pryzmat Media",
  },
  mateusz: {
    name: "Mateusz Gołębiowski",
    title: "CEO | Prezes Zarządu",
    phone: "+48 503 835 707",
    email: "mateusz.golebiowski@pryzmat.media",
    website: "www.pryzmat.media",
    company: "Pryzmat Media",
  },
  tomasz: {
    name: "Tomasz Dłuski",
    title: "Zespół wsparcia SellersKit",
    email: "test@sellersk.it",
    website: "www.sellersk.it",
    company: "SellersKit · Pryzmat Media",
  },
};

export function signatureFor(user: Pick<User, "id" | "name" | "role" | "signature">, mailboxEmail: string): EmployeeSignature {
  return structuredClone(user.signature ?? employeeSignatures[user.id] ?? {
    name: user.name,
    title: user.role,
    email: mailboxEmail,
    website: "www.sellersk.it",
    company: "SellersKit · Pryzmat Media",
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
