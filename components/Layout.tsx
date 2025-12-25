
import React from 'react';
import { translations } from '../translations';
import { Language } from '../types';
import { COLORS } from '../constants';

interface LayoutProps {
  children: React.ReactNode;
  lang: Language;
  setLang: (l: Language) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onVoiceClick: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, lang, setLang, activeTab, setActiveTab, onVoiceClick }) => {
  const t = translations[lang];

  const navItems = [
    { id: 'home', icon: '🏠', label: lang === 'en' ? 'Home' : 'ಮನೆ' },
    { id: 'market', icon: '📈', label: t.market },
    { id: 'marketplace', icon: '🛒', label: t.sell },
    { id: 'schemes', icon: '🏛️', label: t.schemes },
    { id: 'ai', icon: '🔍', label: t.pest },
  ];

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto shadow-2xl relative bg-[#fcf8f2]">
      {/* Header */}
      <header className="sticky top-0 z-50 p-4 bg-white border-b flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold" style={{ color: COLORS.primary }}>{t.title}</h1>
          <p className="text-xs text-gray-500">{t.welcome}</p>
        </div>
        <button 
          onClick={() => setLang(lang === 'en' ? 'kn' : 'en')}
          className="px-3 py-1 rounded-full border border-green-700 text-xs font-bold text-green-800 bg-green-50"
        >
          {t.langToggle}
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 pb-24 overflow-y-auto px-4 pt-4">
        {children}
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t p-2 flex justify-around items-center shadow-[0_-4px_10px_rgba(0,0,0,0.05)] z-50">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center p-2 rounded-xl transition-all ${
              activeTab === item.id ? 'bg-green-100 scale-110' : 'text-gray-400'
            }`}
          >
            <span className="text-xl">{item.icon}</span>
            <span className="text-[10px] mt-1 font-semibold">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Voice Assistant Bubble */}
      <button 
        onClick={onVoiceClick}
        className="fixed bottom-24 right-4 w-14 h-14 bg-[#bc6c25] rounded-full shadow-lg flex items-center justify-center text-white text-2xl animate-bounce z-40"
      >
        🎙️
      </button>
    </div>
  );
};

export default Layout;
