import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CallManager, CallState } from '../call/CallManager.js';

/** Mudo/câmera/tela + o preview do que VOCÊ está mandando (canto inferior esquerdo). */
export function CallControls({ call }: { call: CallManager }) {
  const [state, setState] = useState<CallState>(call.state);
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    call.onState = (s) => setState({ ...s });
    call.onLocalStream = (stream) => {
      if (previewRef.current) previewRef.current.srcObject = stream;
    };
    return () => {
      call.onState = null;
      call.onLocalStream = null;
    };
  }, [call]);

  const hasPreview = state.video || state.screen;

  return (
    <div style={styles.wrap}>
      {hasPreview && <video ref={previewRef} autoPlay playsInline muted style={styles.preview} />}
      <div style={styles.buttons}>
        <button
          onClick={() => call.toggleMute()}
          style={{ ...styles.btn, background: state.muted ? '#ff6b6b' : '#150a24' }}
        >
          {state.muted ? 'Mudo' : 'Microfone'}
        </button>
        <button
          onClick={() => void call.setCamera(!state.video)}
          style={{ ...styles.btn, background: state.video ? '#8b7bff' : '#150a24' }}
        >
          {state.video ? 'Câmera ligada' : 'Câmera'}
        </button>
        <button
          onClick={() => void call.setScreen(!state.screen)}
          style={{ ...styles.btn, background: state.screen ? '#8b7bff' : '#150a24' }}
        >
          {state.screen ? 'Parar tela' : 'Compartilhar tela'}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
  },
  preview: {
    width: 160,
    height: 120,
    borderRadius: 8,
    border: '2px solid #8b7bff',
    objectFit: 'cover',
    background: '#000',
  },
  buttons: {
    display: 'flex',
    gap: 8,
  },
  btn: {
    padding: '10px 14px',
    borderRadius: 999,
    border: '1px solid #2a1f4a',
    color: '#efe7ff',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'system-ui, sans-serif',
  },
};
