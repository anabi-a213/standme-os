import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, appendRow, findRowByValue, objectToRow, sheetUrl } from '../services/google/sheets';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType1 } from '../services/telegram/bot';
import { buildKnowledgeContext, saveKnowledge } from '../services/knowledge';

export class ContractorCoordAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Contractor & Supplier Coordinator',
    id: 'agent-10',
    description: 'Manage contractor communications',
    commands: ['/addcontractor', '/bookcontractor', '/contractors'],
    requiredRole: UserRole.ADMIN,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const cmd = ctx.command.toLowerCase();

    if (cmd === '/addcontractor') {
      return this.addContractor(ctx);
    } else if (cmd === '/bookcontractor') {
      return this.bookContractor(ctx);
    } else if (cmd === '/contractors') {
      return this.listContractors(ctx);
    }

    await this.respond(ctx.chatId, 'Commands: /addcontractor name | company | specialty | region | phone | email\n/bookcontractor name | project | dates\n/contractors');
    return { success: true, message: 'Help shown', confidence: 'HIGH' };
  }

  private async addContractor(ctx: AgentContext): Promise<AgentResponse> {
    const parts = ctx.args.split('|').map(s => s.trim());
    if (parts.length < 3) {
      await this.respond(ctx.chatId, 'Usage: /addcontractor name | company | specialty | region | phone | email');
      return { success: false, message: 'Insufficient data', confidence: 'LOW' };
    }

    const [name, company, specialty, region, phone, email] = parts;
    const id = `CON-${Date.now()}`;

    await appendRow(SHEETS.CONTRACTOR_DB, objectToRow(SHEETS.CONTRACTOR_DB, {
      id,
      name: name || '',
      company: company || '',
      specialty: specialty || '',
      region: region || '',
      phone: phone || '',
      email: email || '',
      rating: '',
      lastBooked: '',
      notes: '',
    }));

    // Save to knowledge base so Brain and other agents can reference this contractor
    await saveKnowledge({
      source: `Contractor DB — ${name}`,
      sourceType: 'manual',
      topic: company || name,
      tags: `contractor, ${specialty || ''}, ${region || ''}, supplier`.replace(/, ,/g, ','),
      content: `Contractor: ${name} (${company}). Specialty: ${specialty || 'unknown'}. Region: ${region || 'unknown'}. Contact: ${email || phone || 'see Contractor DB'}.`,
    }).catch(() => {});

    const contractorSheetLink = sheetUrl(SHEETS.CONTRACTOR_DB);
    await this.respond(ctx.chatId, `✅ Contractor added: ${name} (${company}) — ${specialty}${contractorSheetLink ? `\n📊 [View Contractor DB](${contractorSheetLink})` : ''}`);
    return { success: true, message: `Contractor ${name} added`, confidence: 'HIGH' };
  }

  private async bookContractor(ctx: AgentContext): Promise<AgentResponse> {
    const parts = ctx.args.split('|').map(s => s.trim());
    if (parts.length < 2) {
      await this.respond(ctx.chatId, 'Usage: /bookcontractor name | project | dates');
      return { success: false, message: 'Insufficient data', confidence: 'LOW' };
    }

    const contractorName = parts[0];
    const project = parts[1] || '';
    const dates = parts.slice(2).join(' ') || '';

    // Find contractor
    const contractor = await findRowByValue(SHEETS.CONTRACTOR_DB, 'B', contractorName);
    if (!contractor) {
      await this.respond(ctx.chatId, `Contractor "${contractorName}" not found.`);
      return { success: false, message: 'Contractor not found', confidence: 'HIGH' };
    }

    // Pull any relevant project/contractor history from knowledge base
    const kbContext = await buildKnowledgeContext(`${contractorName} ${project} contractor`).catch(() => '');

    // Draft booking message (no budget revealed)
    const bookingDraft = await generateText(
      `Draft a professional booking message for contractor "${contractor.data[1]}" ` +
      `(company: ${contractor.data[2]}, specialty: ${contractor.data[3]}) ` +
      `for project "${project}", dates: ${dates || 'TBD'}.\n` +
      (kbContext ? `\nRelevant context from our records:\n${kbContext}\n` : '') +
      `\nIMPORTANT: Do NOT mention any budget or rates. Keep it professional and direct.`,
      'You draft contractor booking messages. Professional, never reveal budget or rates.',
      300
    );

    await sendToMo(formatType1(
      `Book Contractor: ${contractor.data[1]}`,
      `Project: ${project}`,
      `Message draft:\n\n${bookingDraft}`,
      `book_${contractor.data[0]}`
    ));

    await this.respond(ctx.chatId, `📝 Booking draft for ${contractor.data[1]} sent to Mo for approval.`);
    return { success: true, message: 'Booking draft sent for approval', confidence: 'HIGH' };
  }

  private async listContractors(ctx: AgentContext): Promise<AgentResponse> {
    const rows = await readSheet(SHEETS.CONTRACTOR_DB);
    const filter = (ctx.args || '').toLowerCase().trim();

    if (rows.length <= 1) {
      await this.respond(ctx.chatId,
        'No contractors in database yet.\n\n' +
        '*To build your contractor network, start with:*\n' +
        '  1. Stand carpenters / builders (per region: Dubai, Germany, Spain, France)\n' +
        '  2. Graphics printers (large-format, per show city)\n' +
        '  3. AV / LED wall installers\n' +
        '  4. Electricians (certified per venue)\n' +
        '  5. Logistics / freight (especially DWTC-approved for Dubai)\n\n' +
        'Add your first: `/addcontractor name | company | specialty | region | phone | email`'
      );
      return { success: true, message: 'Empty contractor DB', confidence: 'HIGH' };
    }

    let data = rows.slice(1);
    if (filter) data = data.filter(r =>
      (r[3] || '').toLowerCase().includes(filter) || // specialty
      (r[4] || '').toLowerCase().includes(filter)    // region
    );

    if (!data.length) {
      await this.respond(ctx.chatId,
        `No contractors found matching "${filter}".\n\n` +
        `Try: /contractors (no filter) or /contractors [specialty] or /contractors [region]\n` +
        `Add one: /addcontractor name | company | specialty | region | phone | email`
      );
      return { success: true, message: 'No matching contractors', confidence: 'HIGH' };
    }

    const list = data.map(r => `  ${r[1] || '?'} — ${r[2] || '?'} (${r[3] || '?'}) — ${r[4] || '?'}`).join('\n');
    await this.respond(ctx.chatId, `*Contractors${filter ? ` — ${filter}` : ''}:*\n${list}`);
    return { success: true, message: 'Contractor list shown', confidence: 'HIGH' };
  }
}
