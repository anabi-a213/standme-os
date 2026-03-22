/**
 * Workflow Engine
 *
 * Automated pipelines that chain agents together without human intervention.
 * Subscribes to the AgentEventBus and also owns two cron jobs.
 *
 * ── 5 Workflows ────────────────────────────────────────────────────────────
 *
 * W1  lead.created (HOT/WARM)     → Auto-enrich after 3-min delay (Agent-02)
 * W2  deal.won                    → Notify Mo: record lesson + suggest case study
 * W3  Cron: Mon 9am               → Extract industry scoring modifiers from lessons → KB
 * W4  lead.enriched (readiness≥7) → Notify Mo: brief / outreach opportunity
 * W5  Cron: daily 7am             → Stale-lead rescue: enrich PENDING leads >24h old
 *
 * ── Overlap Guard ──────────────────────────────────────────────────────────
 * Each workflow tracks in-progress runs per entity. If the same workflow
 * is already running for the same entity it is silently skipped (no queue,
 * no retry — W5 will catch anything that slips through).
 *
 * ── IMPORTANT ──────────────────────────────────────────────────────────────
 * Call initWorkflowEngine() AFTER all agents are registered in index.ts.
 * getAgent() is called lazily at runtime, not at module load.
 */

import cron from 'node-cron';
import { agentEventBus, AgentEvent } from './agent-event-bus';
import { getAgent } from '../agents/registry';
import { SHEETS } from '../config/sheets';
import { appendRow, readSheet } from './google/sheets';
import { sendToMo, formatType2, formatType3 } from './telegram/bot';
import { saveKnowledge } from './knowledge';
import { writeSystemLog } from '../utils/system-log';
import { logger } from '../utils/logger';

// ── WORKFLOW_LOG helpers ────────────────────────────────────────────────────

type WFStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';

async function logWF(entry: {
  workflowId: string;
  workflowName: string;
  trigger: string;
  entityName: string;
  status: WFStatus;
  startedAt: string;
  completedAt?: string;
  steps?: string;
  notes?: string;
}): Promise<void> {
  await appendRow(SHEETS.WORKFLOW_LOG, [
    `WF-${Date.now()}`,
    entry.workflowId,
    entry.workflowName,
    entry.trigger,
    entry.entityName,
    entry.status,
    entry.startedAt,
    entry.completedAt || '',
    entry.steps || '',
    entry.notes || '',
  ]).catch(err =>
    logger.warn(`[WorkflowEngine] WORKFLOW_LOG write failed: ${err.message}`)
  );
}

// ── Overlap guard ───────────────────────────────────────────────────────────

const running = new Map<string, boolean>(); // `${workflowId}::${entityId}`

function guardStart(workflowId: string, entityId: string): boolean {
  const key = `${workflowId}::${entityId}`;
  if (running.get(key)) {
    logger.warn(`[WorkflowEngine] Overlap guard: ${key} already running — skipping`);
    return false;
  }
  running.set(key, true);
  return true;
}

function guardEnd(workflowId: string, entityId: string): void {
  running.delete(`${workflowId}::${entityId}`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function moId(): number {
  return parseInt(process.env.MO_TELEGRAM_ID || '0');
}

function systemCtx(command: string, args = '') {
  return {
    userId: 'SYSTEM' as const,
    chatId: moId(),
    command,
    args,
    role: 'ADMIN' as any,
    language: 'en' as const,
  };
}

// ── W1: HOT/WARM lead created → auto-enrich after 3 minutes ────────────────

async function w1_autoEnrich(event: AgentEvent): Promise<void> {
  const status = ((event.data.status as string) || '').toUpperCase();
  if (status !== 'HOT' && status !== 'WARM') return;
  if (!guardStart('W1', event.entityId)) return;

  const startedAt = new Date().toISOString();
  await logWF({ workflowId: 'W1', workflowName: 'Auto-Enrich HOT/WARM Lead', trigger: 'lead.created', entityName: event.entityName, status: 'RUNNING', startedAt });

  logger.info(`[WorkflowEngine] W1: will enrich "${event.entityName}" in 3 min`);

  setTimeout(async () => {
    try {
      const enrichAgent = getAgent('/enrich');
      if (!enrichAgent) throw new Error('Agent-02 (/enrich) not found in registry');

      await enrichAgent.run(systemCtx('/enrich', event.entityName));

      await logWF({
        workflowId: 'W1', workflowName: 'Auto-Enrich HOT/WARM Lead',
        trigger: 'lead.created', entityName: event.entityName,
        status: 'DONE', startedAt, completedAt: new Date().toISOString(),
        steps: 'triggered agent-02 /enrich',
      });

      logger.info(`[WorkflowEngine] W1 complete: enrichment triggered for "${event.entityName}"`);
    } catch (err: any) {
      logger.error(`[WorkflowEngine] W1 failed for "${event.entityName}": ${err.message}`);
      await logWF({
        workflowId: 'W1', workflowName: 'Auto-Enrich HOT/WARM Lead',
        trigger: 'lead.created', entityName: event.entityName,
        status: 'FAILED', startedAt, completedAt: new Date().toISOString(),
        notes: err.message,
      });
    } finally {
      guardEnd('W1', event.entityId);
    }
  }, 3 * 60 * 1000); // 3-minute delay — Railway restarts handled by W5
}

// ── W2: Deal won → notify Mo: record lesson + case study prompt ─────────────

async function w2_dealWon(event: AgentEvent): Promise<void> {
  if (!guardStart('W2', event.entityId)) return;

  const startedAt = new Date().toISOString();
  await logWF({ workflowId: 'W2', workflowName: 'Deal Won Actions', trigger: 'deal.won', entityName: event.entityName, status: 'RUNNING', startedAt });

  try {
    await sendToMo(formatType2(
      `Deal Won: ${event.entityName}`,
      `"${event.entityName}" moved to Won.\n\n` +
      `*Next steps:*\n` +
      `• Record lessons: /lesson ${event.entityName}\n` +
      `• Build a case study: /casestudy ${event.entityName}\n` +
      `• Generate portfolio entry: /portfolio ${event.entityName}`
    ));

    // Save deal won event to KB for deal analyser + marketing
    await saveKnowledge({
      source: `deal-won-${event.entityId}-${Date.now()}`,
      sourceType: 'manual',
      topic: event.entityName,
      tags: `deal,won,${event.entityName.toLowerCase().replace(/\s+/g, '-')}`,
      content: `Deal won: "${event.entityName}" moved to stage "${event.data.to || '06 Won'}". Recorded at ${event.timestamp}.`,
    }).catch(() => {});

    await logWF({
      workflowId: 'W2', workflowName: 'Deal Won Actions',
      trigger: 'deal.won', entityName: event.entityName,
      status: 'DONE', startedAt, completedAt: new Date().toISOString(),
      steps: 'notified Mo, saved KB entry',
    });
  } catch (err: any) {
    await logWF({
      workflowId: 'W2', workflowName: 'Deal Won Actions',
      trigger: 'deal.won', entityName: event.entityName,
      status: 'FAILED', startedAt, notes: err.message,
    });
  } finally {
    guardEnd('W2', event.entityId);
  }
}

// ── W3: Monday 9am — extract industry scoring modifiers from lessons ─────────

async function w3_scoringModifiers(): Promise<void> {
  const entityId = `W3-${new Date().toISOString().substring(0, 10)}`;
  if (!guardStart('W3', entityId)) return;

  const startedAt = new Date().toISOString();
  await logWF({ workflowId: 'W3', workflowName: 'Weekly Scoring Modifiers', trigger: 'cron:mon-9am', entityName: 'system', status: 'RUNNING', startedAt });

  try {
    const lessons = await readSheet(SHEETS.LESSONS_LEARNED);
    if (lessons.length <= 1) {
      await logWF({ workflowId: 'W3', workflowName: 'Weekly Scoring Modifiers', trigger: 'cron:mon-9am', entityName: 'system', status: 'SKIPPED', startedAt, notes: 'No lessons data yet' });
      return;
    }

    // Tally win/loss by show (col B = showName, col E = outcome WON/LOST)
    const showStats = new Map<string, { won: number; lost: number }>();
    for (const row of lessons.slice(1)) {
      const show = (row[2] || 'unknown').toLowerCase(); // col C = showName
      const outcome = (row[4] || '').toUpperCase();      // col E = outcome
      const s = showStats.get(show) || { won: 0, lost: 0 };
      if (outcome === 'WON') s.won++;
      if (outcome === 'LOST') s.lost++;
      showStats.set(show, s);
    }

    let saved = 0;
    for (const [show, stats] of showStats) {
      if (stats.won + stats.lost < 2) continue; // need ≥2 data points
      const winRate = Math.round((stats.won / (stats.won + stats.lost)) * 100);
      await saveKnowledge({
        source: `scoring-modifier-show-${show.replace(/\s+/g, '-')}-${new Date().toISOString().substring(0, 10)}`,
        sourceType: 'manual',
        topic: 'scoring-modifier',
        tags: `scoring,modifier,show,${show},win-rate`,
        content: `Show "${show}" win rate: ${winRate}% (${stats.won} won, ${stats.lost} lost). Use to weight lead scoring for this show.`,
      }).catch(() => {});
      saved++;
    }

    await logWF({
      workflowId: 'W3', workflowName: 'Weekly Scoring Modifiers',
      trigger: 'cron:mon-9am', entityName: 'system',
      status: 'DONE', startedAt, completedAt: new Date().toISOString(),
      steps: `Saved ${saved} show scoring modifiers to KB`,
    });

    if (saved > 0) {
      await sendToMo(formatType2(
        'Weekly Intelligence Update',
        `Scoring modifiers updated from ${lessons.length - 1} project(s).\n${saved} show-level win-rate entries saved to Knowledge Base.\nThese will inform future lead scoring.`
      ));
    }
  } catch (err: any) {
    logger.error(`[WorkflowEngine] W3 failed: ${err.message}`);
    await logWF({ workflowId: 'W3', workflowName: 'Weekly Scoring Modifiers', trigger: 'cron:mon-9am', entityName: 'system', status: 'FAILED', startedAt, notes: err.message });
  } finally {
    guardEnd('W3', entityId);
  }
}

// ── W4: Lead enriched + readiness≥7 → notify Mo ────────────────────────────

async function w4_enrichedReady(event: AgentEvent): Promise<void> {
  const readiness = parseInt((event.data.outreachReadiness as string) || '0');
  if (readiness < 7) return;
  if (!guardStart('W4', event.entityId)) return;

  const startedAt = new Date().toISOString();
  await logWF({ workflowId: 'W4', workflowName: 'Enriched Lead Ready', trigger: 'lead.enriched', entityName: event.entityName, status: 'RUNNING', startedAt });

  try {
    const score = event.data.score as number || 0;
    const show = event.data.showName as string || '';

    await sendToMo(formatType2(
      `Lead Ready: ${event.entityName}`,
      `"${event.entityName}" has been enriched.\n` +
      `Readiness: ${readiness}/10 | Score: ${score}/10${show ? ` | Show: ${show}` : ''}\n\n` +
      `*Suggested next steps:*\n` +
      `• /brief ${event.entityName} — Generate concept brief\n` +
      `• /outreach ${event.entityName} — Start email outreach`
    ));

    await logWF({
      workflowId: 'W4', workflowName: 'Enriched Lead Ready',
      trigger: 'lead.enriched', entityName: event.entityName,
      status: 'DONE', startedAt, completedAt: new Date().toISOString(),
      steps: `Notified Mo (readiness=${readiness})`,
    });
  } catch (err: any) {
    await logWF({
      workflowId: 'W4', workflowName: 'Enriched Lead Ready',
      trigger: 'lead.enriched', entityName: event.entityName,
      status: 'FAILED', startedAt, notes: err.message,
    });
  } finally {
    guardEnd('W4', event.entityId);
  }
}

// ── W5: Daily 7am — stale lead rescue ──────────────────────────────────────

async function w5_staleLead(): Promise<void> {
  const entityId = `W5-${new Date().toISOString().substring(0, 10)}`;
  if (!guardStart('W5', entityId)) return;

  const startedAt = new Date().toISOString();
  await logWF({ workflowId: 'W5', workflowName: 'Stale Lead Auto-Enrich', trigger: 'cron:daily-7am', entityName: 'system', status: 'RUNNING', startedAt });

  try {
    const rows = await readSheet(SHEETS.LEAD_MASTER);
    const now = Date.now();
    const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
    let staleCount = 0;

    for (const row of rows.slice(1)) {
      const enrichStatus = row[17] || ''; // col R
      const timestamp = row[1] || '';     // col B

      // Rescue any unenriched lead — no score gate (email leads score 0 but still need enrichment)
      if (enrichStatus !== 'PENDING' && enrichStatus !== '' && enrichStatus !== 'QUALIFYING') continue;

      const age = now - new Date(timestamp).getTime();
      if (age >= STALE_THRESHOLD) staleCount++;
    }

    if (staleCount === 0) {
      await logWF({ workflowId: 'W5', workflowName: 'Stale Lead Auto-Enrich', trigger: 'cron:daily-7am', entityName: 'system', status: 'SKIPPED', startedAt, notes: 'No stale leads found' });
      return;
    }

    const enrichAgent = getAgent('/enrich');
    if (!enrichAgent) throw new Error('Agent-02 (/enrich) not found in registry');

    logger.info(`[WorkflowEngine] W5: found ${staleCount} stale leads — triggering enrichment`);
    await enrichAgent.run(systemCtx('/enrich'));

    await logWF({
      workflowId: 'W5', workflowName: 'Stale Lead Auto-Enrich',
      trigger: 'cron:daily-7am', entityName: 'system',
      status: 'DONE', startedAt, completedAt: new Date().toISOString(),
      steps: `${staleCount} stale leads found, triggered agent-02`,
    });
  } catch (err: any) {
    logger.error(`[WorkflowEngine] W5 failed: ${err.message}`);
    await logWF({ workflowId: 'W5', workflowName: 'Stale Lead Auto-Enrich', trigger: 'cron:daily-7am', entityName: 'system', status: 'FAILED', startedAt, notes: err.message });
  } finally {
    guardEnd('W5', entityId);
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

/**
 * Must be called AFTER all agents are registered in index.ts.
 * getAgent() is resolved lazily at runtime — not at module load.
 */
export function initWorkflowEngine(): void {
  // Event-driven workflows
  agentEventBus.on('lead.created', e => {
    w1_autoEnrich(e).catch(err =>
      logger.error(`[WorkflowEngine] W1 unhandled: ${err.message}`)
    );
  });

  agentEventBus.on('deal.won', e => {
    w2_dealWon(e).catch(err =>
      logger.error(`[WorkflowEngine] W2 unhandled: ${err.message}`)
    );
  });

  agentEventBus.on('lead.enriched', e => {
    w4_enrichedReady(e).catch(err =>
      logger.error(`[WorkflowEngine] W4 unhandled: ${err.message}`)
    );
  });

  // Scheduled workflows (Europe/Berlin timezone — matches all other crons)
  cron.schedule('0 9 * * 1', () => {
    w3_scoringModifiers().catch(err =>
      logger.error(`[WorkflowEngine] W3 cron error: ${err.message}`)
    );
  }, { timezone: 'Europe/Berlin' });

  cron.schedule('0 7 * * *', () => {
    w5_staleLead().catch(err =>
      logger.error(`[WorkflowEngine] W5 cron error: ${err.message}`)
    );
  }, { timezone: 'Europe/Berlin' });

  logger.info('[WorkflowEngine] ✓ 5 workflows active (W1-W5) | 2 cron jobs registered');
  logger.info('[WorkflowEngine]   W1: HOT/WARM lead → auto-enrich (3 min delay)');
  logger.info('[WorkflowEngine]   W2: Deal won → lesson + case study prompt');
  logger.info('[WorkflowEngine]   W3: Mon 9am → scoring modifiers from lessons → KB');
  logger.info('[WorkflowEngine]   W4: Lead enriched (readiness≥7) → notify Mo');
  logger.info('[WorkflowEngine]   W5: Daily 7am → stale lead auto-rescue');
}
