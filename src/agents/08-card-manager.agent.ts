import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { TRELLO_CONFIG } from '../config/trello';
import {
  getBoardCardsWithListNames,
  findListByName,
  moveCard,
  addComment,
  TrelloCard,
} from '../services/trello/client';
import { formatType2 } from '../services/telegram/bot';
import { agentEventBus } from '../services/agent-event-bus';

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
      await this.respond(
        ctx.chatId,
        `Usage: \`/movecard [client name] | [target stage]\`\n\n` +
        `Pipeline stages:\n` +
        TRELLO_CONFIG.pipelineStages.map(s => `  • ${s}`).join('\n')
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

    // Find the card by name (fuzzy match)
    const cards = await getBoardCardsWithListNames(boardId);
    const match = this.findCard(cards, cardSearch);

    if (!match) {
      await this.respond(
        ctx.chatId,
        `No card found matching "*${cardSearch}*".\n` +
        `Check the name and try again, or use /status to see all cards.`
      );
      return { success: false, message: `Card not found: ${cardSearch}`, confidence: 'LOW' };
    }

    // Find the target list
    const targetList = await findListByName(boardId, targetStageName);

    if (!targetList) {
      await this.respond(
        ctx.chatId,
        `Stage "*${targetStageName}*" not found.\n\n` +
        `Available stages:\n` +
        TRELLO_CONFIG.pipelineStages.map(s => `  • ${s}`).join('\n')
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

  private findCard(cards: TrelloCard[], search: string): TrelloCard | null {
    const q = search.toLowerCase();
    // Exact match first
    const exact = cards.find(c => c.name.toLowerCase() === q);
    if (exact) return exact;
    // Partial match
    const partial = cards.find(c => c.name.toLowerCase().includes(q));
    if (partial) return partial;
    // Word-level match (any word in search matches any word in card name)
    const words = q.split(/\s+/).filter(w => w.length > 2);
    return cards.find(c => words.some(w => c.name.toLowerCase().includes(w))) || null;
  }
}
