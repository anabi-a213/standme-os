/**
 * Pipeline Runner
 *
 * Manages sequential agent pipelines for individual leads.
 * Each lead can progress through: INTAKE → ENRICH → BRIEF → PROPOSAL → OUTREACH
 *
 * State is persisted to the Knowledge Base so pipelines survive Railway restarts.
 *
 * Usage:
 *   pipelineRunner.start(leadId, companyName)      // called by Agent-01 / Agent-18
 *   pipelineRunner.advance(leadId, stepData)        // called after each step completes
 *   pipelineRunner.block(leadId, reason)            // step failed or awaiting data
 *   pipelineRunner.resume(leadId, ctx)              // user runs /resume <company>
 *   pipelineRunner.getActive()                      // for /status dashboard
 *   pipelineRunner.getBlocked()                     // for W5 morning briefing
 *   pipelineRunner.loadFromKB()                     // called at startup in index.ts
 */

import {
  saveKnowledge,
  updateKnowledge,
  searchKnowledge,
  sourceExistsInKnowledge,
} from './knowledge';
import { logger } from '../utils/logger';

export type PipelineStep   = 'INTAKE' | 'ENRICH' | 'BRIEF' | 'PROPOSAL' | 'OUTREACH';
export type PipelineStatus = 'WAITING' | 'RUNNING' | 'BLOCKED' | 'DONE' | 'DONE_DEGRADED' | 'SKIPPED' | 'FAILED';

export interface PipelineState {
  leadId:           string;
  companyName:      string;
  currentStep:      PipelineStep;
  status:           PipelineStatus;
  blockedReason?:   string;
  completedSteps:   PipelineStep[];
  /** Steps that ran with degraded/partial data (tier 1 brief, assumed fields, etc.) */
  degradedSteps:    PipelineStep[];
  /** Steps intentionally skipped due to missing optional data */
  skippedSteps:     PipelineStep[];
  /** Structured output data forwarded between steps (not persisted to KB for size reasons) */
  stepData:         Partial<Record<PipelineStep, Record<string, unknown>>>;
  createdAt:        string;
  updatedAt:        string;
}

const PIPELINE_STEPS: PipelineStep[] = ['INTAKE', 'ENRICH', 'BRIEF', 'PROPOSAL', 'OUTREACH'];

// Steps that have a Telegram command (for resume)
const STEP_COMMANDS: Partial<Record<PipelineStep, string>> = {
  ENRICH:   '/enrich',
  BRIEF:    '/brief',
  OUTREACH: '/outreach',
};

class PipelineRunnerService {
  private pipelines = new Map<string, PipelineState>();

  // ── Start ───────────────────────────────────────────────────────────────────

  /**
   * Create a new pipeline for a lead.
   * Safe to call multiple times — returns existing pipeline if already started.
   * INTAKE is assumed complete when the pipeline starts.
   */
  start(leadId: string, companyName: string): PipelineState {
    const existing = this.pipelines.get(leadId);
    if (existing && existing.status !== 'FAILED') return existing;

    const state: PipelineState = {
      leadId,
      companyName,
      currentStep:    'ENRICH',
      status:         'WAITING',
      completedSteps: ['INTAKE'],
      degradedSteps:  [],
      skippedSteps:   [],
      stepData:       {},
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
    };

    this.pipelines.set(leadId, state);
    this.persist(state).catch(err =>
      logger.warn(`[Pipeline] persist failed for ${companyName}: ${err.message}`)
    );

    logger.info(`[Pipeline] Started for "${companyName}" (${leadId})`);
    return state;
  }

  // ── Advance ─────────────────────────────────────────────────────────────────

  /**
   * Mark the current step as complete and advance to the next one.
   * Optionally attach structured data from the completed step.
   */
  advance(leadId: string, stepData?: Record<string, unknown>): PipelineState | null {
    const state = this.pipelines.get(leadId);
    if (!state) return null;

    if (stepData) state.stepData[state.currentStep] = stepData;

    state.completedSteps.push(state.currentStep);

    const nextIdx = PIPELINE_STEPS.indexOf(state.currentStep) + 1;
    if (nextIdx >= PIPELINE_STEPS.length) {
      state.status = 'DONE';
    } else {
      state.currentStep = PIPELINE_STEPS[nextIdx];
      state.status      = 'WAITING';
    }

    state.updatedAt = new Date().toISOString();
    this.persist(state).catch(() => {});

    logger.info(`[Pipeline] Advanced "${state.companyName}" → ${state.currentStep} (${state.status})`);
    return state;
  }

  // ── Degraded ─────────────────────────────────────────────────────────────────

  /**
   * Mark the current step as completed in degraded mode (ran with assumptions/partial data).
   * The pipeline continues but the step is flagged for follow-up.
   */
  markDegraded(leadId: string, stepData?: Record<string, unknown>): PipelineState | null {
    const state = this.pipelines.get(leadId);
    if (!state) return null;
    state.degradedSteps.push(state.currentStep);
    return this.advance(leadId, stepData);
  }

  // ── Skip ─────────────────────────────────────────────────────────────────────

  /**
   * Skip the current step (optional step with insufficient data).
   * Pipeline advances without completing this step.
   */
  skipStep(leadId: string, reason?: string): PipelineState | null {
    const state = this.pipelines.get(leadId);
    if (!state) return null;
    state.skippedSteps.push(state.currentStep);
    logger.info(`[Pipeline] Skipped "${state.companyName}" step ${state.currentStep}${reason ? `: ${reason}` : ''}`);
    return this.advance(leadId);
  }

  // ── Block ────────────────────────────────────────────────────────────────────

  /**
   * Mark a pipeline as blocked at its current step.
   * Mo can unblock it via /resume <company>.
   */
  block(leadId: string, reason: string): void {
    const state = this.pipelines.get(leadId);
    if (!state) return;

    state.status        = 'BLOCKED';
    state.blockedReason = reason;
    state.updatedAt     = new Date().toISOString();

    this.persist(state).catch(() => {});
    logger.warn(`[Pipeline] BLOCKED "${state.companyName}" at ${state.currentStep}: ${reason}`);
  }

  // ── Resume ───────────────────────────────────────────────────────────────────

  /**
   * Resume a blocked pipeline by re-running the current step.
   * Returns the step command string to run, or null if nothing to resume.
   */
  resume(leadId: string): { command: string; args: string } | null {
    const state = this.pipelines.get(leadId);
    if (!state) return null;
    if (state.status !== 'BLOCKED' && state.status !== 'WAITING') return null;

    const command = STEP_COMMANDS[state.currentStep];
    if (!command) return null;

    state.status        = 'RUNNING';
    state.blockedReason = undefined;
    state.updatedAt     = new Date().toISOString();

    this.persist(state).catch(() => {});
    return { command, args: state.companyName };
  }

  /**
   * Find a pipeline by company name (case-insensitive, partial match).
   * Used for /resume <company name> where we don't know the leadId.
   */
  findByCompany(companyName: string): PipelineState | null {
    const needle = companyName.toLowerCase();
    for (const state of this.pipelines.values()) {
      if (state.companyName.toLowerCase().includes(needle)) return state;
    }
    return null;
  }

  // ── Getters ──────────────────────────────────────────────────────────────────

  get(leadId: string): PipelineState | undefined {
    return this.pipelines.get(leadId);
  }

  /** All pipelines that are not yet DONE */
  getActive(): PipelineState[] {
    return Array.from(this.pipelines.values()).filter(p => p.status !== 'DONE');
  }

  /** Pipelines blocked and waiting for Mo's action */
  getBlocked(): PipelineState[] {
    return Array.from(this.pipelines.values()).filter(p => p.status === 'BLOCKED');
  }

  /** All pipelines (including done) */
  getAll(): PipelineState[] {
    return Array.from(this.pipelines.values());
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  /** Save state to KB. stepData is excluded (too large, not needed on restart). */
  private async persist(state: PipelineState): Promise<void> {
    const source = `pipeline-state-${state.leadId}`;

    const payload = {
      leadId:         state.leadId,
      companyName:    state.companyName,
      currentStep:    state.currentStep,
      status:         state.status,
      blockedReason:  state.blockedReason,
      completedSteps: state.completedSteps,
      degradedSteps:  state.degradedSteps,
      skippedSteps:   state.skippedSteps,
      createdAt:      state.createdAt,
      updatedAt:      state.updatedAt,
    };

    const content = JSON.stringify(payload);

    try {
      const exists = await sourceExistsInKnowledge(source);
      if (exists) {
        await updateKnowledge(source, {
          content,
          tags: `pipeline,${state.status.toLowerCase()},${state.currentStep.toLowerCase()}`,
          lastUpdated: new Date().toISOString(),
        } as any);
      } else {
        await saveKnowledge({
          source,
          sourceType: 'system',
          topic:      state.companyName,
          tags:       `pipeline,${state.status.toLowerCase()},${state.currentStep.toLowerCase()}`,
          content,
        });
      }
    } catch (err: any) {
      logger.warn(`[Pipeline] KB persist failed for ${state.companyName}: ${err.message}`);
    }
  }

  /**
   * Load active pipeline states from KB on startup.
   * Call this in index.ts after KB is ready. Restores pipelines that were
   * interrupted by a Railway restart.
   */
  async loadFromKB(): Promise<void> {
    try {
      const entries = await searchKnowledge('pipeline-state', 200);
      const pipelineEntries = entries.filter(e => e.source?.startsWith('pipeline-state-'));

      let loaded = 0;
      for (const entry of pipelineEntries) {
        try {
          const parsed = JSON.parse(entry.content);

          // Skip completed pipelines — no need to keep them in memory
          if (parsed.status === 'DONE') continue;

          const state: PipelineState = {
            ...parsed,
            degradedSteps: parsed.degradedSteps || [],
            skippedSteps:  parsed.skippedSteps  || [],
            stepData:      {}, // step data is not persisted
          };

          this.pipelines.set(state.leadId, state);
          loaded++;
        } catch {
          // Invalid JSON — corrupt entry, skip
        }
      }

      logger.info(`[Pipeline] Loaded ${loaded} active pipeline(s) from KB on startup`);
    } catch (err: any) {
      logger.warn(`[Pipeline] Failed to load from KB: ${err.message}`);
    }
  }
}

export const pipelineRunner = new PipelineRunnerService();
