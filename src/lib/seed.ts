import { randomUUID } from "node:crypto";
import type { DemoState } from "./types";
import { mailboxes } from "./mailboxes";
import { team } from "./team";

export function seedState(): DemoState {
  return {
    schemaVersion: 4,
    revision: 1,
    generation: randomUUID(),
    users: structuredClone(team),
    mailboxes: structuredClone(mailboxes),
    conversations: [],
    drafts: [],
    knowledge: [],
    notifications: [],
    archives: [],
    appliedRequests: [],
  };
}
