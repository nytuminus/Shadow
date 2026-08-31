import { createRoot } from 'react-dom/client';
import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createGame } from './game/createGame.js';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;
    gameRef.current = createGame(containerRef.current);
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }} />;
}

createRoot(document.getElementById('root')!).render(<App />);
