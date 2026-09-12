import type { DemoState, User } from "./types";
import { employeeSignatures } from "./signatures";

export const team: User[] = [
  {
    id: "michal",
    name: "Michał Kluska",
    initials: "TD",
    color: "#6b6157",
    role: "Zespół wsparcia",
    signature: employeeSignatures.michal,
  },
  {
    id: "jan",
    name: "Jan Kowalski",
    initials: "MG",
    color: "#874c00",
    role: "CEO | Prezes Zarządu",
    signature: employeeSignatures.jan,
  },
  {
    id: "anna",
    name: "Anna Nowak",
    initials: "IB",
    color: "#c98d68",
    role: "Kierownik Działu Administracji i Finansów",
    signature: employeeSignatures.anna,
  },
];

export const isActiveUser = (user: User) => user.active !== false;

export function syncTeamProfiles(state: DemoState) {
  let changed = false;
  for (const profile of team) {
    const user = state.users.find((item) => item.id === profile.id && isActiveUser(item));
    if (!user) continue;
    const active = user.active;
    const next = { ...structuredClone(profile), ...(active === undefined ? {} : { active }) };
    if (user.signature?.custom && next.signature) next.signature.custom = structuredClone(user.signature.custom);
    if (JSON.stringify(user) !== JSON.stringify(next)) {
      Object.assign(user, next); changed = true;
    }
  }
  return changed;
}

export function migrateTeam(state: DemoState): boolean {
  if (state.schemaVersion !== 2) return false;
  // Historical identities retain authorship, assignments and separate drafts.
  state.users = [
    ...structuredClone(team),
    ...state.users.map((user) => ({ ...user, active: false })),
  ];
  state.schemaVersion = 3;
  state.revision++;
  return true;
}
