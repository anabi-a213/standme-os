import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { getBoardCardsWithListNames } from '../services/trello/client';
import { readSheet } from '../services/google/sheets';
import { SHEETS } from '../config/sheets';
import { formatType3 } from '../services/telegram/bot';
import { generateText } from '../services/ai/client';
import { buildKnowledgeContext } from '../services/knowledge';

export class ProjectStatusAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Project Status Dashboard',
    id: 'agent-06',
    description: 'Unified pipeline snapshot across all systems',
    commands: ['/status'],
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const sections: { label: string; content: string }[] = [];
    const unconfiguredBoards: string[] = [];

    // Sales Pipeline
    const salesBoardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
    if (salesBoardId) {
      try {
        const cards = await getBoardCardsWithListNames(salesBoardId);
        const byStage = new Map<string, number>();
        for (const card of cards) {
          const stage = card.listName || 'Unknown';
          byStage.set(stage, (byStage.get(stage) || 0) + 1);
        }
        sections.push({
          label: 'SALES PIPELINE',
          content: Array.from(byStage.entries()).map(([s, c]) => `  ${s}: ${c}`).join('\n'),
        });
      } catch {
        sections.push({ label: 'SALES PIPELINE', content: '  Could not fetch' });
      }
    } else {
      unconfiguredBoards.push('Sales Pipeline (TRELLO_BOARD_SALES_PIPELINE)');
    }

    // Other boards summary
    for (const [key, envKey] of [['DESIGN', 'TRELLO_BOARD_DESIGN'], ['OPERATION', 'TRELLO_BOARD_OPERATION'], ['PRODUCTION', 'TRELLO_BOARD_PRODUCTION']]) {
      const boardId = process.env[envKey];
      if (!boardId) { unconfiguredBoards.push(`${key} (TRELLO_BOARD_${key})`); continue; }
      try {
        const cards = await getBoardCardsWithListNames(boardId);
        const overdue = cards.filter(c => { if (!c.due) return false; const d = new Date(c.due); return !isNaN(d.getTime()) && d < new Date(); }).length;
        sections.push({
          label: key,
          content: `  ${cards.length} cards${overdue > 0 ? ` (${overdue} overdue)` : ''}`,
        });
      } catch {
        sections.push({ label: key, content: '  Could not fetch' });
      }
    }

    // Technical deadlines
    try {
      const deadlines = await readSheet(SHEETS.TECHNICAL_DEADLINES);
      const imminent = deadlines.slice(1).filter(r => {
        const dates = [r[3], r[4], r[5], r[6], r[7]].filter(Boolean);
        return dates.some(d => {
          const parsed = new Date(d);
          if (isNaN(parsed.getTime())) return false; // skip invalid date strings
          const diff = (parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          return diff >= 0 && diff <= 7;
        });
      });
      if (imminent.length > 0) {
        sections.push({
          label: 'IMMINENT DEADLINES',
          content: imminent.map(r => `  ${r[1]} — ${r[2]}`).join('\n'),
        });
      }
    } catch { /* skip */ }

    // AI summary
    try {
      const summaryData = sections.map(s => `${s.label}: ${s.content}`).join('\n');
      const kbContext = await buildKnowledgeContext('project status pipeline deadline client').catch(() => '');
      const prompt = kbContext
        ? `Project status data:\n${summaryData}\n\nRelevant business context from documents:\n${kbContext}\n\nSummarize in 2-3 bullet points with recommended next action:`
        : `Summarize this project status in 2-3 bullet points with recommended next action:\n${summaryData}`;
      const aiSummary = await generateText(
        prompt,
        'You are a concise project manager for StandMe, an exhibition stand design & build company.',
        200
      );
      sections.push({ label: 'AI SUMMARY', content: aiSummary });
    } catch { /* skip */ }

    if (unconfiguredBoards.length > 0) {
      sections.push({
        label: 'NOT CONFIGURED',
        content: unconfiguredBoards.map(b => `  • ${b} — set env var to enable`).join('\n'),
      });
    }

    const dashboard = formatType3('PIPELINE STATUS', sections);
    await this.respond(ctx.chatId, dashboard);

    return { success: true, message: 'Status dashboard sent', confidence: 'HIGH' };
  }
}
