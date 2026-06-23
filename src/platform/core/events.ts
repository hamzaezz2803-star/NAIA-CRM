import type { PlatformModuleId } from "@/platform/core/modules";

export type DomainEventPayload = Record<string, unknown>;

export type DomainEvent = {
  id: string;
  organizationId: string;
  module: PlatformModuleId | "platform";
  eventType: string;
  payload: DomainEventPayload;
  occurredAt: string;
  actorProfileId?: string;
};

export type OutboxMessage = DomainEvent & {
  status: "pending" | "processing" | "processed" | "failed";
  attempts: number;
  lastError?: string;
};

export function createDomainEvent(
  input: Omit<DomainEvent, "id" | "occurredAt">,
): DomainEvent {
  return {
    ...input,
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
  };
}
