import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { TRELLO_CONFIG } from '../config/trello';
import {
  getBoardCardsWithListNames,
  getBoardLists,
  moveCard,
  addComment,
  TrelloCard,
  TrelloList,
} from '../services/trello/client';
import { formatType2 } from '../services/telegram/bot';
import { agentEventBus } from '../services/agent-event-bus';
import { readSheet } from '../services/google/sheets';
import { SHEETS } from '../config/sheets';

export class CardManagerAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Trello Card Manager',
    id: 'agent-08',
    description: 'Move and update Trello cards across pipeline stages',
    commands: ['/movecard', '/cardmove'],
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const args = ctx.args?.trim();

    if (!args) {
      const boardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
      let stagesText = TRELLO_CONFIG.pipelineStages.map(s => `  • ${s}`).join('\n');
      if (boardId) {
        try {
          const liveLists = await getBoardLists(boardId);
          if (liveLists.length > 0) stagesText = liveLists.map(l => `  • ${l.name}`).join('\n');
        } catch { /* fall back to hardcoded list */ }
      }
      await this.respond(
        ctx.chatId,
        `Usage: \`/movecard [client name] | [target stage]\`\n\n` +
        `Pass stage as number ("03"), keyword ("concept brief"), or ordinal ("third").\n\n` +
        `Pipeline stages:\n${stagesText}`
      );
      return { success: false, message: 'No args provided', confidence: 'LOW' };
    }

    const parts = args.split('|').map(s => s.trim());
    const [cardSearch, targetStageName] = parts;

    if (!cardSearch || !targetStageName) {
      await this.respond(
        ctx.chatId,
        `Please provide both a card name and a target stage.\n` +
        `Example: \`/movecard Pharma Corp | 04 Proposal Sent\``
      );
      return { success: false, message: 'Missing card name or target stage', confidence: 'LOW' };
    }

    const boardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
    if (!boardId) {
      await this.respond(ctx.chatId, 'Sales Pipeline board is not configured.');
      return { success: false, message: 'Board ID missing', confidence: 'LOW' };
    }

    // Resolve SM-XXXX lead ID → company name for search
    let resolvedSearch = cardSearch;
    if (/^SM-\d+$/i.test(cardSearch)) {
      try {
        const leads = await readSheet(SHEETS.LEAD_MASTER);
        const leadRow = leads.slice(1).find(r => (r[0] || '').toUpperCase() === cardSearch.toUpperCase());
        if (leadRow) resolvedSearch = leadRow[2] || cardSearch; // col C = companyName
      } catch { /* non-fatal — fall through to name search */ }
    }

    // Find the card by name (fuzzy match)
    const cards = await getBoardCardsWithListNames(boardId);
    const matches = this.findCards(cards, resolvedSearch);

    if (matches.length === 0) {
      await this.respond(
        ctx.chatId,
        `No card found matching "*${cardSearch}*".\n` +
        `Check the name and try again, or use /status to see all cards.`
      );
      return { success: false, message: `Card not found: ${cardSearch}`, confidence: 'LOW' };
    }

    if (matches.length > 1) {
      const list = matches.map((c, i) => `  ${i + 1}. ${c.name} (${c.listName || 'Unknown'})`).join('\n');
      await this.respond(
        ctx.chatId,
        `Multiple cards match "*${cardSearch}*" — please be more specific:\n\n${list}\n\n` +
        `Re-run with the full name:\n\`/movecard [exact name] | [stage]\``
      );
      return { success: false, message: `Multiple matches for: ${cardSearch}`, confidence: 'LOW' };
    }

    const match = matches[0];

    // Resolve the target stage: fetch live lists, match by numeric prefix or keyword
    const { list: targetList, liveLists } = await this.resolveStage(boardId, targetStageName);

    if (!targetList) {
      const stagesText = liveLists.length > 0
        ? liveLists.map(l => `  • ${l.name}`).join('\n')
        : TRELLO_CONFIG.pipelineStages.map(s => `  • ${s}`).join('\n');
      await this.respond(
        ctx.chatId,
        `Stage "*${targetStageName}*" not found.\n\nAvailable stages:\n${stagesText}`
      );
      return { success: false, message: `Stage not found: ${targetStageName}`, confidence: 'LOW' };
    }

    // Don't move if already in that stage
    if (match.idList === targetList.id) {
      await this.respond(
        ctx.chatId,
        `*${match.name}* is already in *${targetList.name}*. No move needed.`
      );
      return { success: true, message: 'Card already in target stage', confidence: 'HIGH' };
    }

    const fromStage = match.listName || 'Unknown';

    // Move the card
    await moveCard(match.id, targetList.id);

    // Emit deal lifecycle events so Workflow Engine can react (W2: deal won actions)
    const targetLower = targetList.name.toLowerCase();
    if (targetLower.includes('06') || targetLower.includes('won')) {
      agentEventBus.publish('deal.won', {
        agentId: this.config.id,
        entityId: match.id,
        entityName: match.name,
        data: { from: fromStage, to: targetList.name, cardId: match.id },
      });
    } else if (targetLower.includes('07') || targetLower.includes('lost') || targetLower.includes('delayed')) {
      agentEventBus.publish('deal.lost', {
        agentId: this.config.id,
        entityId: match.id,
        entityName: match.name,
        data: { from: fromStage, to: targetList.name, cardId: match.id },
      });
    }

    // Add a comment to the card noting the move
    const mover = ctx.userId || 'team';
    try {
      await addComment(
        match.id,
        `📦 Card moved from *${fromStage}* → *${targetList.name}* by ${mover} via StandMe OS`
      );
    } catch {
      // Comment failure is non-fatal
    }

    await this.respond(
      ctx.chatId,
      `✅ *${match.name}*\n` +
      `Moved: *${fromStage}* → *${targetList.name}*`
    );

    return {
      success: true,
      message: `Card "${match.name}" moved from "${fromStage}" to "${targetList.name}"`,
      confidence: 'HIGH',
      data: { cardId: match.id, from: fromStage, to: targetList.name },
    };
  }

  /**
   * Fetch live board lists and resolve a user-supplied stage identifier to the
   * correct TrelloList without guessing or hardcoding stage names.
   *
   * Matching priority (uses the FULL name returned by the API):
   *   1. Numeric prefix: "3" | "03" | "stage 3" → matches list whose name starts with "03"
   *   2. Ordinal word: "third" → "03", "fourth" → "04", etc.
   *   3. Keyword substring fallback (case-insensitive): "concept brief" → "03 Concept Brief"
   */
  private async resolveStage(
    boardId: string,
    input: string,
  ): Promise<{ list: TrelloList | null; liveLists: TrelloList[] }> {
    const liveLists = await getBoardLists(boardId);
    const q = input.toLowerCase().trim();

    // Extract numeric value from input: "3", "03", "stage 3", "step 3"
    const numMatch = q.match(/\b0?(\d{1,2})\b/);
    const targetPrefix = numMatch ? numMatch[1].padStart(2, '0') : null;

    // Map ordinal words to two-digit prefixes
    const ORDINALS: Record<string, string> = {
      first: '01', second: '02', third: '03', fourth: '04',
      fifth: '05', sixth: '06', seventh: '07',
    };
    const ordEntry = Object.entries(ORDINALS).find(([w]) => q.includes(w));
    const prefix = targetPrefix ?? (ordEntry ? ordEntry[1] : null);

    const list =
      liveLists.find(l => {
        const lName = l.name.toLowerCase();
        // 1. Numeric prefix match: "03" in "03 Concept Brief" or "03 — Concept Brief"
        if (prefix) {
          const lPre = lName.match(/^0?(\d{1,2})/)?.[1]?.padStart(2, '0');
          if (lPre === prefix) return true;
        }
        // 2. Keyword substring match
        return lName.includes(q);
      }) ?? null;

    return { list, liveLists };
  }

  private findCards(cards: TrelloCard[], search: string): TrelloCard[] {
    const q = search.toLowerCase();
    // Exact match → single result
    const exact = cards.filter(c => c.name.toLowerCase() === q);
    if (exact.length > 0) return exact;
    // Partial match
    const partial = cards.filter(c => c.name.toLowerCase().includes(q));
    if (partial.length > 0) return partial;
    // Word-level match
    const words = q.split(/\s+/).filter(w => w.length > 2);
    return cards.filter(c => words.some(w => c.name.toLowerCase().includes(w)));
  }
}
