import React, { useState } from 'react';
import { Navbar } from './components/Navbar.js';
import { Hero } from './components/Hero.js';
import { EditorialSections } from './components/EditorialSections.js';
import { AppConsole } from './components/AppConsole.js';

export function App(): React.JSX.Element {
  const [currentView, setCurrentView] = useState<'home' | 'console' | 'activity'>('home');

  const handleExplore = () => {
    setCurrentView('console');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleHowItWorks = () => {
    const el = document.getElementById('how-it-works');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="app-root">
      {currentView === 'home' && (
        <>
          <Navbar currentView={currentView} onNavigate={(v) => setCurrentView(v as 'home' | 'console' | 'activity')} />
          <Hero onExplore={handleExplore} onHowItWorks={handleHowItWorks} />
          <EditorialSections onLaunchConsole={() => setCurrentView('console')} />
        </>
      )}

      {(currentView === 'console' || currentView === 'activity') && (
        <AppConsole onBackToHome={() => setCurrentView('home')} />
      )}
    </div>
  );
}

export default App;
