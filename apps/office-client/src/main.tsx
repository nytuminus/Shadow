import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { createGame } from './game/createGame.js';
import { LoginScreen } from './ui/LoginScreen.js';
import { loadSession, clearSession, type Session } from './net/session.js';
import { me, getRtcConfig } from './net/api.js';
import { connectOfficeSocket, type OfficeSocket } from './net/socket.js';
import { CallManager } from './call/CallManager.js';
import { VideoOverlay } from './call/VideoOverlay.js';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [muted, setMuted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const socketRef = useRef<OfficeSocket | null>(null);
  const callRef = useRef<CallManager | null>(null);

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
    const container = containerRef.current;
    let cancelled = false;

    (async () => {
      const { iceServers } = await getRtcConfig().catch(() => ({ iceServers: [] as RTCIceServer[] }));
      if (cancelled) return;

      const socket = connectOfficeSocket(session.token);
      socketRef.current = socket;
      socket.on('connect_error', () => {
        clearSession();
        setSession(null);
      });

      const callManager = new CallManager(socket, iceServers);
      callRef.current = callManager;
      const videoOverlay = new VideoOverlay(container);

      gameRef.current = createGame(container, { socket, employee: session.employee, callManager, videoOverlay });
    })();

    return () => {
      cancelled = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
      callRef.current?.disconnectAll();
      callRef.current = null;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [session]);

  if (checking) return null;
  if (!session) return <LoginScreen onLogin={setSession} />;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <button
        onClick={() => {
          callRef.current?.toggleMute();
          setMuted((m) => !m);
        }}
        style={{
          position: 'absolute',
          left: 16,
          bottom: 16,
          zIndex: 10,
          padding: '10px 16px',
          borderRadius: 999,
          border: '1px solid #2a1f4a',
          background: muted ? '#ff6b6b' : '#150a24',
          color: '#efe7ff',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        {muted ? 'Mudo' : 'Microfone ligado'}
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
