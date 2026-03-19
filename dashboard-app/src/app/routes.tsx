import { createBrowserRouter } from 'react-router';
import { RootLayout } from './layouts/root-layout';
import { AgentsView } from './views/agents-view';
import { WorkspaceView } from './views/workspace-view';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: AgentsView },
      { path: 'workspace', Component: WorkspaceView },
    ],
  },
], { basename: '/dashboard' });
