/**
 * Pure threading/transition helpers ported from the proven prototype
 * (src/lib/mail-import.ts + mail-outbox.ts). No IO — fully unit-testable.
 */

export type ConversationStatus = 'open' | 'pending' | 'resolved';

/** Inbound mail reopens a resolved/pending conversation (prototype: "W toku"). */
export function statusAfterInbound(current: ConversationStatus): ConversationStatus {
  return current === 'resolved' || current === 'pending' ? 'open' : current;
}

/** A successful agent send hands the ball to the customer. */
export function statusAfterAgentSend(_current: ConversationStatus): ConversationStatus {
  return 'pending';
}

/** Dedupe + cap thread-id lists (prototype keeps at most 50, newest last). */
export function capThreadIds(values: string[], cap = 50): string[] {
  return [...new Set(values.filter(Boolean))].slice(-cap);
}

/** "Re:"/"Odp:" prefix only when not already present (prototype rule). */
export function replySubject(subject: string): string {
  return /^(re|odp):/i.test(subject) ? subject : `Re: ${subject}`;
}

/** RFC Message-ID for outbound mail, domain taken from the sender address. */
export function outboundMessageId(uuid: string, fromAddress: string): string {
  const domain = fromAddress.split('@')[1] ?? 'open-triage.local';
  return `<${uuid}@${domain}>`;
}

/**
 * Does this parsed inbound mail belong to an existing conversation?
 * Match on References + In-Reply-To against the conversation's known
 * Message-IDs (prototype threading rule; dedupe of the same message happens
 * separately via the Message.messageId lookup).
 */
export function isThreadMatch(
  parsedRefs: string[],
  conversation: { messageIds: string[] },
): boolean {
  return parsedRefs.some((ref) => conversation.messageIds.includes(ref));
}