import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { appendRow, objectToRow } from '../services/google/sheets';
import { getBoardCardsWithListNames, addComment } from '../services/trello/client';
import { sendToTeam, formatType3 } from '../services/telegram/bot';

export class CrossBoardAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Cross-Board Project Tracker',
    id: 'agent-16',
    description: 'Monitor health across all 4 Trello boards',
    commands: ['/crossboard'],
    schedule: '30 8 * * *', // 8:30am daily
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const boardConfigs = [
      { key: 'TRELLO_BOARD_SALES_PIPELINE', label: 'Sales' },
      { key: 'TRELLO_BOARD_DESIGN', label: 'Design' },
      { key: 'TRELLO_BOARD_OPERATION', label: 'Operation' },
      { key: 'TRELLO_BOARD_PRODUCTION', label: 'Production' },
    ];

    const allCards = new Map<string, { board: string; card: any; listName: string }[]>();
    const flags: string[] = [];
    const sections: { label: string; content: string }[] = [];

    for (const boardConfig of boardConfigs) {
      const boardId = process.env[boardConfig.key];
      if (!boardId) continue;

      try {
        const cards = await getBoardCardsWithListNames(boardId);

        sections.push({
          label: boardConfig.label.toUpperCase(),
          content: `  ${cards.length} active cards`,
        });

        for (const card of cards) {
          // Group by card name for cross-referencing
          const key = card.name.toLowerCase().split('—')[0].trim();
          if (!allCards.has(key)) allCards.set(key, []);
          allCards.get(key)!.push({ board: boardConfig.label, card, listName: card.listName || '' });

          // Check for stale cards (5+ days no activity)
          const lastActivity = new Date(card.dateLastActivity);
          const daysSince = Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSince >= 5) {
            flags.push(`⏳ ${card.name} (${boardConfig.label}) — no activity for ${daysSince} days`);
          }

          // Check for overdue
          if (card.due && new Date(card.due) < new Date()) {
            flags.push(`🔴 ${card.name} (${boardConfig.label}) — OVERDUE`);
          }
        }
      } catch (err: any) {
        sections.push({
          label: boardConfig.label.toUpperCase(),
          content: `  Error: ${err.message}`,
        });
      }
    }

    // Cross-reference: Won on Sales but no Operation/Production activity
    for (const [key, entries] of allCards) {
      const boards = entries.map(e => e.board);
      const salesEntry = entries.find(e => e.board === 'Sales');

      if (salesEntry && salesEntry.listName.includes('Won')) {
        if (!boards.includes('Operation') && !boards.includes('Production')) {
          flags.push(`⚠️ ${salesEntry.card.name} — WON but no Operation/Production cards`);

          // Add comment on Sales card (never create cards on other boards)
          try {
            await addComment(salesEntry.card.id, `[Cross-Board Check] Won but no matching Operation/Production card found — ${new Date().toISOString().split('T')[0]}`);
          } catch { /* non-critical */ }
        }
      }

      // Design card with no matching Operation card
      const hasDesign = boards.includes('Design');
      const hasOperation = boards.includes('Operation');
      if (hasDesign && !hasOperation) {
        flags.push(`⚠️ ${key} — Design card exists but no Operation card`);
      }
    }

    if (flags.length > 0) {
      sections.push({ label: 'FLAGS', content: flags.join('\n') });
    } else {
      sections.push({ label: 'FLAGS', content: '  All clear ✅' });
    }

    // Update cross-agent hub
    for (const [key, entries] of allCards) {
      try {
        await appendRow(SHEETS.CROSS_AGENT_HUB, objectToRow(SHEETS.CROSS_AGENT_HUB, {
          timestamp: new Date().toISOString(),
          clientName: key,
          showName: '',
          salesStatus: entries.find(e => e.board === 'Sales')?.listName || 'N/A',
          designStatus: entries.find(e => e.board === 'Design')?.listName || 'N/A',
          operationStatus: entries.find(e => e.board === 'Operation')?.listName || 'N/A',
          productionStatus: entries.find(e => e.board === 'Production')?.listName || 'N/A',
          flags: flags.filter(f => f.toLowerCase().includes(key)).join('; '),
          lastUpdated: new Date().toISOString(),
        }));
      } catch { /* non-critical */ }
    }

    const report = formatType3('CROSS-BOARD HEALTH', sections);
    const recipients = [
      process.env.MO_TELEGRAM_ID || '',
      process.env.HADEER_TELEGRAM_ID || '',
    ].filter(Boolean);
    await sendToTeam(report, recipients);

    if (ctx.chatId && ctx.command !== 'scheduled') {
      await this.respond(ctx.chatId, report);
    }

    return {
      success: true,
      message: `Cross-board check: ${flags.length} flags`,
      confidence: 'HIGH',
    };
  }
}
