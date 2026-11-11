import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { StatusProvider } from './app/StatusProvider.js';
import { Shell } from './components/Shell.js';
import { StateView } from './components/StateView.js';
import { OverviewPage } from './features/overview/OverviewPage.js';
import { CandidatesPage } from './features/candidates/CandidatesPage.js';
import { CandidateDetailPage } from './features/candidates/CandidateDetailPage.js';
import { RiskPage } from './features/risk/RiskPage.js';
import { PortfolioPage } from './features/portfolio/PortfolioPage.js';
import { JournalPage } from './features/journal/JournalPage.js';
import { MorePage } from './features/more/MorePage.js';

function NotFound(): ReactNode {
  return (
    <StateView
      kind="empty"
      title="Page not found"
      text="This route is not part of the operational dashboard. Use the navigation to go back."
      testId="not-found"
    />
  );
}

export function App(): ReactNode {
  return (
    <StatusProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<OverviewPage />} />
            <Route path="candidates" element={<CandidatesPage />} />
            <Route path="candidates/:id" element={<CandidateDetailPage />} />
            <Route path="risk" element={<RiskPage />} />
            <Route path="portfolio" element={<PortfolioPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="more" element={<MorePage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StatusProvider>
  );
}