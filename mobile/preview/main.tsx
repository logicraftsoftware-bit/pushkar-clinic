import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DemoProvider } from '../src/data/DemoContext';
import { screens } from '../src/screens';
import { screenNames } from '../src/components/ui';
import { PreviewNavigation } from './navigation';
import type { Navigation, ScreenName } from '../src/navigation';
function Preview() {
  const initial = new URLSearchParams(location.search).get(
    'screen',
  ) as ScreenName;
  const [history, setHistory] = useState<ScreenName[]>([
    initial && screens[initial] ? initial : 'Welcome',
  ]);
  const route = history[history.length - 1];
  const nav = {
    navigate: (next: ScreenName) => setHistory(old => [...old, next]),
    canGoBack: () => history.length > 1,
    goBack: () => setHistory(old => old.slice(0, -1)),
    reset: ({ routes }: { routes: { name: ScreenName }[] }) =>
      setHistory(routes.map(item => item.name)),
  } as unknown as Navigation;
  const Component = screens[route];
  const bare = new URLSearchParams(location.search).has('bare');
  return (
    <div
      style={{
        display: 'flex',
        gap: 40,
        justifyContent: 'center',
        padding: bare ? 0 : '32px 20px',
        alignItems: 'flex-start',
      }}
    >
      {!bare && (
        <aside style={{ width: 270, paddingTop: 10 }}>
          <h1 style={{ color: '#075592', margin: '0 0 8px' }}>JibonCare</h1>
          <p style={{ color: '#5f718a', fontSize: 13 }}>
            24 static React Native screens
            <br />
            Temporary branding · Offline mock data
          </p>
          <div style={{ display: 'grid', gap: 5 }}>
            {screenNames.map(([name, label], i) => (
              <button
                key={name}
                onClick={() => nav.navigate(name)}
                style={{
                  textAlign: 'left',
                  border: 0,
                  borderRadius: 8,
                  padding: '8px 12px',
                  background: route === name ? '#075592' : '#fff',
                  color: route === name ? '#fff' : '#132d4a',
                  fontSize: 12,
                }}
              >
                {String(i + 1).padStart(2, '0')} · {label}
              </button>
            ))}
          </div>
        </aside>
      )}
      <div
        id="phone"
        style={{
          width: 390,
          height: 844,
          flexShrink: 0,
          borderRadius: bare ? 0 : 38,
          border: bare ? 'none' : '7px solid #102438',
          overflow: 'hidden',
          boxShadow: bare ? 'none' : '0 16px 50px #18365925',
          background: '#f5f8fd',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            background: ['Welcome', 'OTP'].includes(route)
              ? '#f1f7ff'
              : '#137bbb',
            color: ['Welcome', 'OTP'].includes(route) ? '#071833' : '#fff',
            height: 27,
            padding: '7px 22px 0',
            fontSize: 11,
            display: 'flex',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <span>9:41</span>
          <span>▰ ▴ ▰</span>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <SafeAreaProvider
            initialMetrics={{
              frame: { x: 0, y: 0, width: 390, height: 817 },
              insets: { top: 0, left: 0, right: 0, bottom: 0 },
            }}
          >
            <PreviewNavigation.Provider value={nav}>
              <DemoProvider>
                <Component />
              </DemoProvider>
            </PreviewNavigation.Provider>
          </SafeAreaProvider>
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
