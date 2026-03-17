import { BaseAgent } from './base-agent';

const agents = new Map<string, BaseAgent>();

export function registerAgent(agent: BaseAgent): void {
  agents.set(agent.config.id, agent);
  for (const cmd of agent.config.commands) {
    agents.set(cmd, agent);
  }
}

export function getAgent(idOrCommand: string): BaseAgent | undefined {
  return agents.get(idOrCommand.toLowerCase());
}

export function getAllAgents(): BaseAgent[] {
  const unique = new Map<string, BaseAgent>();
  for (const [, agent] of agents) {
    unique.set(agent.config.id, agent);
  }
  return Array.from(unique.values());
}

export function getScheduledAgents(): BaseAgent[] {
  return getAllAgents().filter(a => a.config.schedule);
}
