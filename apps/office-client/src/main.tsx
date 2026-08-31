import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { createGame } from './game/createGame.js';
import { LoginScreen } from './ui/LoginScreen.js';
import { loadSession, clearSession, type Session } from './net/session.js';
import { me } from './net/api.js';
import { connectOfficeSocket, type OfficeSocket } from './net/socket.js';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const socketRef = useRef<OfficeSocket | null>(null);

  // Sessão salva do login anterior: confirma com o servidor antes de confiar nela.
  useEffect(() => {
    const saved = loadSession();
    if (!saved) {
      setChecking(false);
      return;
    }
    me(saved.token)
      .then(() => setSession(saved))
      .catch(() => clearSession())
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!session || !containerRef.current || gameRef.current) return;
    const socket = connectOfficeSocket(session.token);
    socketRef.current = socket;
    // Token inválido/expirado direto no handshake do socket: volta pro login.
    socket.on('connect_error', () => {
      clearSession();
      setSession(null);
    });
    gameRef.current = createGame(containerRef.current, { socket, employee: session.employee });
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session]);

  if (checking) return null;
  if (!session) return <LoginScreen onLogin={setSession} />;

  return <div ref={containerRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }} />;
}

createRoot(document.getElementById('root')!).render(<App />);
