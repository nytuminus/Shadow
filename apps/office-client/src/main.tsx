import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { createGame } from './game/createGame.js';
import { LoginScreen } from './ui/LoginScreen.js';
import { ChatPanel } from './ui/ChatPanel.js';
import { CallControls } from './ui/CallControls.js';
import { loadSession, clearSession, type Session } from './net/session.js';
import { me, getRtcConfig } from './net/api.js';
import { connectOfficeSocket, type OfficeSocket } from './net/socket.js';
import { CallManager } from './call/CallManager.js';
import { VideoOverlay } from './call/VideoOverlay.js';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [live, setLive] = useState<{ socket: OfficeSocket; callManager: CallManager } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

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
      socket.on('connect_error', () => {
        clearSession();
        setSession(null);
      });

      const callManager = new CallManager(socket, iceServers);
      const videoOverlay = new VideoOverlay(container);

      gameRef.current = createGame(container, { socket, employee: session.employee, callManager, videoOverlay });
      setLive({ socket, callManager });
    })();

    return () => {
      cancelled = true;
      gameRef.current?.destroy(true);
      gameRef.current = null;
      setLive((prev) => {
        prev?.callManager.disconnectAll();
        prev?.socket.disconnect();
        return null;
      });
    };
  }, [session]);

  if (checking) return null;
  if (!session) return <LoginScreen onLogin={setSession} />;

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {live && (
        <>
          <CallControls call={live.callManager} />
          <ChatPanel socket={live.socket} />
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
