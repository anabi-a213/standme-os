/**
 * Agent 20 — Woodpecker Knowledge Sync
 *
 * PURPOSE: Read-only data harvester. Pulls Woodpecker campaign stats and
 * replied/interested prospect data and saves everything to the Knowledge Base
 * so Brain and other agents have real context when talking to clients.
 *
 * DOES NOT: send emails, add prospects, trigger campaigns, touch Sheets Lead
 * Master, or interact with any other part of the system.
 *
 * Runs automatically at 03:00 Berlin every night + manually via /wpsync.
 * Also used by the /webhook/woodpecker endpoint to save real-time reply bodies.
 */

import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { updateKnowledge } from '../services/knowledge';
import {
  listCampaigns,
  getCampaignStats,
  getProspectsByCampaign,
  WoodpeckerProspect,
} from '../services/woodpecker/client';
import { generateText } from '../services/ai/client';
import { logger } from '../utils/logger';

export class WoodpeckerSyncAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Woodpecker Knowledge Sync',
    id: 'agent-20',
    description: 'Harvest Woodpecker campaign data into the Knowledge Base for Brain context (read-only)',
    commands: ['/wpsync', '/wpstats'],
    requiredRole: UserRole.ADMIN,
    schedule: '0 3 * * *', // 03:00 Berlin every night
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const cmd = ctx.command.toLowerCase();
    if (cmd === '/wpsync')   return this.runSync(ctx, false);
    if (cmd === '/wpstats')  return this.showStats(ctx);
    return { success: false, message: 'Unknown command', confidence: 'LOW' };
  }

  // ─── /wpsync — full sync (also called by scheduler) ──────────────────────

  async runSync(ctx: AgentContext, silent = false): Promise<AgentResponse> {
    if (!silent) await this.respond(ctx.chatId, '🔄 Syncing Woodpecker data to Knowledge Base...');

    const results = { campaigns: 0, replies: 0, updated: 0, errors: 0 };

    let campaigns: Awaited<ReturnType<typeof listCampaigns>>;
    try {
      campaigns = await listCampaigns();
    } catch (err: any) {
      logger.error(`[WPSync] listCampaigns failed: ${err.message}`);
      if (!silent) await this.respond(ctx.chatId, `❌ Cannot reach Woodpecker API: ${err.message}`);
      return { success: false, message: err.message, confidence: 'HIGH' };
    }

    for (const campaign of campaigns) {
      try {
        await this.syncCampaign(campaign.id, campaign.name);
        results.campaigns++;
      } catch (err: any) {
        // Handle 429 rate limit — wait 2s and retry once before giving up
        if (err.message?.includes('429') || err.message?.toLowerCase().includes('rate limit')) {
          logger.warn(`[WPSync] Rate limited on campaign ${campaign.id} — waiting 2s and retrying`);
          await new Promise(r => setTimeout(r, 2000));
          try {
            await this.syncCampaign(campaign.id, campaign.name);
            results.campaigns++;
          } catch (retryErr: any) {
            logger.warn(`[WPSync] Campaign ${campaign.id} failed after retry: ${retryErr.message}`);
            results.errors++;
          }
        } else {
          logger.warn(`[WPSync] Campaign ${campaign.id} failed: ${err.message}`);
          results.errors++;
        }
      }

      // Rate limit: Woodpecker Classic API is strict — 1 req/sec
      await new Promise(r => setTimeout(r, 1100));
    }

    // Always write partial results — even if some campaigns failed
    const msg =
      `✅ Woodpecker sync complete\n` +
      `  Campaigns: ${results.campaigns} | Replied contacts: ${results.replies} | Errors: ${results.errors}\n` +
      `  Data saved to Knowledge Base — Brain will use it in client conversations.` +
      (results.errors > 0 ? `\n  ⚠️ ${results.errors} campaign(s) failed — partial data saved.` : '');

    if (!silent) await this.respond(ctx.chatId, msg);
    logger.info(`[WPSync] Done — ${results.campaigns} campaigns, ${results.replies} replied contacts`);

    return { success: true, message: msg, confidence: results.errors > 0 ? 'MEDIUM' : 'HIGH' };
  }

  // ─── Sync a single campaign ───────────────────────────────────────────────

  private async syncCampaign(campaignId: number, campaignName: string): Promise<void> {
    // 1. Campaign performance summary
    const stats = await getCampaignStats(campaignId);
    const openRate   = stats.sent > 0 ? ((stats.opened   / stats.sent) * 100).toFixed(1) : '0';
    const replyRate  = stats.sent > 0 ? ((stats.replied  / stats.sent) * 100).toFixed(1) : '0';
    const bounceRate = stats.sent > 0 ? ((stats.bounced  / stats.sent) * 100).toFixed(1) : '0';

    const campaignContent =
      `Campaign "${campaignName}" (ID ${campaignId}): ` +
      `${stats.sent} sent, ${openRate}% open rate, ${replyRate}% reply rate, ` +
      `${stats.bounced} bounced (${bounceRate}%), ` +
      `${stats.interested} interested, ${stats.not_interested} not interested, ` +
      `${stats.replied} total replies.`;

    const campaignSource = `woodpecker-campaign-${campaignId}`;
    await updateKnowledge(campaignSource, {
      sourceType: 'woodpecker',
      topic: 'campaign',
      tags: `woodpecker, campaign, outreach, ${campaignName.toLowerCase()}`,
      content: campaignContent,
    });

    // 2. Replied and interested prospects — the most valuable data for Brain
    let replied: WoodpeckerProspect[] = [];
    try {
      replied = await getProspectsByCampaign(campaignId, 'REPLIED');
      await new Promise(r => setTimeout(r, 600));
    } catch { /* some campaigns may have no replied endpoint */ }

    let interested: WoodpeckerProspect[] = [];
    try {
      interested = await getProspectsByCampaign(campaignId, 'INTERESTED');
      await new Promise(r => setTimeout(r, 600));
    } catch { /* silent */ }

    // Deduplicate by email
    const allLeads = [...replied, ...interested];
    const seen = new Set<string>();
    const uniqueLeads = allLeads.filter(p => {
      if (seen.has(p.email)) return false;
      seen.add(p.email);
      return true;
    });

    for (const prospect of uniqueLeads) {
      await this.saveProspectToKB(prospect, campaignName, stats);
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // ─── Save one replied/interested prospect to KB ───────────────────────────

  private async saveProspectToKB(
    prospect: WoodpeckerProspect,
    campaignName: string,
    stats: { sent: number; replied: number; interested: number },
  ): Promise<void> {
    const company  = prospect.company || 'Unknown Company';
    const name     = [prospect.first_name, prospect.last_name].filter(Boolean).join(' ') || 'Unknown';
    const status   = (prospect.status || '').toUpperCase();
    const show     = prospect.snippet1 || '';  // snippet1 = show/hook context
    const title    = prospect.snippet2 || '';  // snippet2 = DM job title

    const content =
      `${company} (${prospect.email}) — contacted via "${campaignName}" campaign. ` +
      `Status: ${status}. Contact: ${name}${title ? ` (${title})` : ''}. ` +
      (show ? `Context: ${show}. ` : '') +
      `Industry: ${prospect.industry || 'unknown'}. ` +
      `Campaign performance: ${stats.sent} sent, ${stats.replied} replied, ${stats.interested} interested.`;

    const source = `woodpecker-prospect-${prospect.email}`;
    await updateKnowledge(source, {
      sourceType: 'woodpecker',
      topic: 'company',
      tags: `woodpecker, prospect, ${status.toLowerCase()}, ${company.toLowerCase()}, ${campaignName.toLowerCase()}`,
      content,
    });
  }

  // ─── Called by /webhook/woodpecker when a real-time reply arrives ─────────
  // This is the richest data — we get the actual reply body text.

  async saveReplyToKB(params: {
    email:       string;
    company?:    string;
    campaignId?: number;
    campaignName?: string;
    replyBody?:  string;
    subject?:    string;
  }): Promise<void> {
    const company  = params.company || params.email.split('@')[1] || 'Unknown';
    const campaign = params.campaignName || (params.campaignId ? `Campaign ${params.campaignId}` : 'Unknown campaign');
    const date     = new Date().toISOString().substring(0, 10);

    let content =
      `REPLY received from ${company} (${params.email}) via "${campaign}" on ${date}. ` +
      (params.subject ? `Subject: "${params.subject}". ` : '');

    // If we have the reply body, summarise it with AI (keeps it under 500 chars)
    if (params.replyBody && params.replyBody.length > 10) {
      try {
        const summary = await generateText(
          `Summarise this cold email reply in 1-2 sentences. Focus on: interest level, any mentioned show/stand size/budget, next step they want.\n\nREPLY:\n${params.replyBody.substring(0, 1000)}`,
          'You summarise email replies for a CRM. Be factual and concise.',
          120,
        );
        content += `Reply summary: ${summary}`;
      } catch {
        // If AI fails, store truncated raw body
        content += `Reply: ${params.replyBody.substring(0, 250)}`;
      }
    }

    content = content.substring(0, 490);

    const source = `woodpecker-reply-${params.email}-${date}`;

    await updateKnowledge(source, {
      sourceType: 'woodpecker',
      topic: 'conversation',
      tags: `woodpecker, reply, ${company.toLowerCase()}, ${campaign.toLowerCase()}`,
      content,
    });

    logger.info(`[WPSync] Saved reply KB entry for ${params.email} (${company})`);
  }

  // ─── /wpstats — show what's in KB from Woodpecker ────────────────────────

  private async showStats(ctx: AgentContext): Promise<AgentResponse> {
    const { searchKnowledge } = await import('../services/knowledge');
    const entries = await searchKnowledge('woodpecker campaign prospect reply', 50);

    const campaigns  = entries.filter(e => e.source.startsWith('woodpecker-campaign-'));
    const prospects  = entries.filter(e => e.source.startsWith('woodpecker-prospect-'));
    const replies    = entries.filter(e => e.source.startsWith('woodpecker-reply-'));

    const sections: { label: string; content: string }[] = [];

    sections.push({
      label: `CAMPAIGNS IN KB (${campaigns.length})`,
      content: campaigns.length
        ? campaigns.map(e => `  • ${e.content.substring(0, 120)}`).join('\n')
        : '  None yet — run /wpsync',
    });

    sections.push({
      label: `REPLIED PROSPECTS IN KB (${prospects.length})`,
      content: prospects.length
        ? prospects.slice(-10).map(e => `  • ${e.content.substring(0, 100)}`).join('\n')
        : '  None yet',
    });

    sections.push({
      label: `LIVE REPLY CONVERSATIONS (${replies.length})`,
      content: replies.length
        ? replies.slice(-5).map(e => `  • ${e.content.substring(0, 120)}`).join('\n')
        : '  None captured yet — configure Woodpecker webhook → /webhook/woodpecker',
    });

    sections.push({
      label: 'COMMANDS',
      content: '`/wpsync` — run a full sync now\n`/wpstats` — show this screen',
    });

    await this.sendSummary(ctx.chatId, '📊 Woodpecker Knowledge Base', sections);
    return { success: true, message: `${entries.length} Woodpecker KB entries`, confidence: 'HIGH' };
  }
}
