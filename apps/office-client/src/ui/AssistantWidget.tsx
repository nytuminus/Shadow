import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

// Reaproveita o padrão de arrastar/encaixar/minimizar do CallPod das Salas
// antigas (web/src/App.tsx) — só que aqui é o assistente Shadow, sempre
// disponível como uma janelinha no canto em vez de tela cheia alternável.

const WIDTH = 360;
const HEIGHT = 480;
const MINI_SIZE = 64;
const STORAGE_KEY = 'shadow.office.assistantPos';

interface Pos {
  x: number;
  y: number;
}

function loadPos(): Pos {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '');
    if (s && typeof s.x === 'number' && typeof s.y === 'number') return s;
  } catch {
    /* posição padrão abaixo */
  }
  return { x: window.innerWidth - WIDTH - 24, y: window.innerHeight - HEIGHT - 96 };
}

export function AssistantWidget() {
  const [min, setMin] = useState(false);
  const [pos, setPos] = useState<Pos>(loadPos);
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const w = min ? MINI_SIZE : WIDTH;
  const h = min ? MINI_SIZE : HEIGHT;

  function clamp(x: number, y: number): Pos {
    return {
      x: Math.max(8, Math.min(window.innerWidth - w - 8, x)),
      y: Math.max(8, Math.min(window.innerHeight - h - 8, y)),
    };
  }

  function onDown(e: ReactPointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  }
  function onMove(e: ReactPointerEvent) {
    if (!drag.current) return;
    drag.current.moved = true;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  }
  function onUp() {
    if (!drag.current) return;
    if (drag.current.moved) {
      // Encaixa no canto horizontal mais próximo — só se realmente arrastou.
      const snapX = pos.x + w / 2 < window.innerWidth / 2 ? 24 : window.innerWidth - w - 24;
      const snapped = clamp(snapX, pos.y);
      setPos(snapped);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapped));
      } catch {
        /* sem localStorage: só não persiste entre sessões */
      }
    }
    drag.current = null;
  }

  if (min) {
    return (
      <button
        onClick={() => setMin(false)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        style={{ ...styles.bubble, left: pos.x, top: pos.y }}
        title="Abrir o Shadow"
      >
        🤖
      </button>
    );
  }

  return (
    <div style={{ ...styles.wrap, left: pos.x, top: pos.y, width: w, height: h }}>
      <div style={styles.head} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <span style={styles.headTitle}>🤖 Shadow</span>
        <button style={styles.headBtn} title="Minimizar" onClick={() => setMin(true)}>
          ▁
        </button>
      </div>
      <iframe src="/assistant" title="Assistente Shadow" style={styles.frame} />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: 'absolute',
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column',
    background: '#0a0410',
    border: '1px solid #2a1f4a',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    background: '#150a24',
    borderBottom: '1px solid #2a1f4a',
    cursor: 'grab',
    userSelect: 'none',
    fontFamily: 'system-ui, sans-serif',
  },
  headTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#efe7ff',
  },
  headBtn: {
    border: 'none',
    background: 'transparent',
    color: '#efe7ff',
    cursor: 'pointer',
    fontSize: 13,
    padding: '2px 6px',
  },
  frame: {
    flex: 1,
    border: 'none',
    width: '100%',
  },
  bubble: {
    position: 'absolute',
    zIndex: 20,
    width: MINI_SIZE,
    height: MINI_SIZE,
    borderRadius: '50%',
    border: '2px solid #8b7bff',
    background: '#150a24',
    fontSize: 28,
    cursor: 'grab',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
  },
};
