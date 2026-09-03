import type { DemoState, User } from "./types";

export const team: User[] = [
  {
    id: "tomasz",
    name: "Tomasz Dłuski",
    initials: "TD",
    color: "#7464c4",
    role: "Zespół wsparcia",
  },
  {
    id: "mateusz",
    name: "Mateusz Gołębiowski",
    initials: "MG",
    color: "#438478",
    role: "Zespół wsparcia",
  },
  {
    id: "irena",
    name: "Irena Bronkowska-Mika",
    initials: "IB",
    color: "#bf7957",
    role: "Zespół wsparcia",
  },
];

export const isActiveUser = (user: User) => user.active !== false;

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
