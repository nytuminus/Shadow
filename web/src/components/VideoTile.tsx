import { useEffect, useRef } from 'react';
import { Avatar } from './Avatar';
import type { PeerState, User } from '../lib/types';

// Um tile da chamada: mostra vídeo (câmera ou tela) quando há, senão o avatar.
// O <video> recebe o MediaStream por ref (não dá pra passar stream por prop no
// JSX). `muted` no vídeo do próprio usuário evita eco.
export function VideoTile({ user, state, stream, isSelf, speaking }: {
  user: User;
  state: PeerState;
  stream: MediaStream | null;
  isSelf?: boolean;
  speaking?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const hasVideo = !!(state.video || state.screen) && !!stream && stream.getVideoTracks().length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (stream && el.srcObject !== stream) {
      el.srcObject = stream;
      el.play?.().catch(() => { /* autoplay pode barrar; sem drama */ });
    }
    if (!stream) el.srcObject = null;
  }, [stream, hasVideo]);

  return (
    <div className={`tile ${state.screen ? 'screen' : ''} ${speaking ? 'speaking' : ''}`}>
      {/* O vídeo fica sempre montado pra receber áudio dos pares; escondido quando não há imagem. */}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={isSelf}
        style={{ display: hasVideo ? 'block' : 'none' }}
      />
      {!hasVideo && <div className="avatar-lg" style={avatarStyle(user.color)}>{initialsOf(user.name)}</div>}
      {state.screen && <span className="tag-screen">🖥️ tela</span>}
      {isSelf && <span className="badge-you">você</span>}
      <div className="nameplate">
        <span>{user.name || 'Convidado'}</span>
        <span className="st">
          {state.muted ? <span className="muted" title="microfone mudo">🔇</span> : <span title="microfone ligado">🎤</span>}
        </span>
      </div>
    </div>
  );
}

function initialsOf(name: string) {
  const p = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function avatarStyle(color?: string): React.CSSProperties {
  const c = color || '#8b7bff';
  return { background: `linear-gradient(140deg, ${c}, ${c}99)` };
}

// Reexport Avatar pra quem importar daqui, se precisar.
export { Avatar };
