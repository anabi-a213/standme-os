/**
 * Agent Event Bus
 *
 * Typed pub/sub backbone for inter-agent communication.
 * Agents publish events after completing key actions; the Workflow Engine
 * (and any other subscriber) reacts without polling.
 *
 * Design rules:
 *  - No imports from agent files (zero circular-dependency risk)
 *  - All events are permanently audited to SYSTEM_LOG
 *  - `publish()` is fire-and-forget safe — callers may await it or not
 */

import { EventEmitter } from 'events';
import { writeSystemLog } from '../utils/system-log';
import { logger } from '../utils/logger';

// ── Event type union ────────────────────────────────────────────────────────

export type AgentEventType =
  | 'lead.created'
  | 'lead.enriched'
  | 'brief.generated'
  | 'deal.won'
  | 'deal.lost'
  | 'lesson.recorded'
  | 'email.lead.received'
  | 'campaign.reply'
  | 'outreach.sent';

export interface AgentEvent {
  type: AgentEventType;
  agentId: string;       // e.g. 'agent-01'
  timestamp: string;     // ISO-8601
  entityId: string;      // lead ID, card ID, email ID — unique per entity
  entityName: string;    // human-readable label (company name, card title)
  data: Record<string, unknown>;
}

// ── Bus ─────────────────────────────────────────────────────────────────────

class AgentEventBus extends EventEmitter {
  /**
   * Publish a typed agent event.
   * - Writes to SYSTEM_LOG (non-blocking, never throws)
   * - Dispatches to all subscribers synchronously (EventEmitter semantics)
   */
  publish(
    eventType: AgentEventType,
    payload: Omit<AgentEvent, 'type' | 'timestamp'>
  ): void {
    const full: AgentEvent = {
      type: eventType,
      timestamp: new Date().toISOString(),
      ...payload,
    };

    // Audit every inter-agent event to SYSTEM_LOG
    writeSystemLog({
      agent: payload.agentId,
      actionType: `event:${eventType}`,
      detail: `${payload.entityName} (${payload.entityId})`,
      result: 'SUCCESS',
      notes: JSON.stringify(payload.data).substring(0, 200),
    }).catch(err =>
      logger.warn(`[EventBus] SYSTEM_LOG write failed: ${err.message}`)
    );

    logger.info(
      `[EventBus] ▶ ${eventType} — ${payload.entityName} [${payload.entityId}] from ${payload.agentId}`
    );

    // Dispatch to subscribers — EventEmitter is synchronous
    super.emit(eventType, full);
  }

  /** Subscribe to a specific event type */
  on(event: AgentEventType, listener: (e: AgentEvent) => void): this {
    return super.on(event, listener);
  }

  /** Subscribe once */
  once(event: AgentEventType, listener: (e: AgentEvent) => void): this {
    return super.once(event, listener);
  }
}

export const agentEventBus = new AgentEventBus();

// Increase max listeners — 18 agents + workflow engine can subscribe
agentEventBus.setMaxListeners(30);
