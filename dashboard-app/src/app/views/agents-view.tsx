import { useOutletContext } from 'react-router';
import { MainContent } from '../components/main-content';

interface OutletContext {
  runningCommands: string[];
  runningAgentIds: string[];
}

export function AgentsView() {
  const { runningCommands, runningAgentIds } = useOutletContext<OutletContext>();
  return <MainContent runningCommands={runningCommands} runningAgentIds={runningAgentIds} />;
}
