import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { ChatMessage } from '@shadow/shared';
import type { OfficeSocket } from '../net/socket.js';

export function ChatPanel({ socket }: { socket: OfficeSocket }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onHistory = (history: ChatMessage[]) => setMessages(history);
    const onMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      setUnread((n) => (open ? n : n + 1));
    };
    socket.on('chat:history', onHistory);
    socket.on('chat:message', onMessage);
    return () => {
      socket.off('chat:history', onHistory);
      socket.off('chat:message', onMessage);
    };
  }, [socket, open]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    socket.emit('chat:send', { text: clean });
    setText('');
  }

  return (
    <div style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 10 }}>
      {open && (
        <div style={styles.panel}>
          <div style={styles.header}>Chat do escritório</div>
          <div ref={listRef} style={styles.list}>
            {messages.length === 0 && <p style={styles.empty}>Nenhuma mensagem ainda.</p>}
            {messages.map((m) => (
              <div key={m.id} style={styles.msg}>
                <span style={styles.msgName}>{m.name}</span>
                <span style={styles.msgText}>{m.text}</span>
              </div>
            ))}
          </div>
          <form onSubmit={handleSubmit} style={styles.form}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Mensagem…"
              style={styles.input}
              maxLength={2000}
            />
            <button type="submit" style={styles.send} disabled={!text.trim()}>
              Enviar
            </button>
          </form>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} style={styles.toggle}>
        {open ? 'Fechar chat' : `Chat${unread ? ` (${unread})` : ''}`}
      </button>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: {
    width: 280,
    height: 360,
    marginBottom: 8,
    display: 'flex',
    flexDirection: 'column',
    background: '#150a24',
    border: '1px solid #2a1f4a',
    borderRadius: 12,
    overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif',
  },
  header: {
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 600,
    color: '#8b7bff',
    borderBottom: '1px solid #2a1f4a',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  empty: {
    color: '#6b6080',
    fontSize: 12,
    margin: 0,
  },
  msg: {
    fontSize: 13,
    color: '#efe7ff',
    lineHeight: 1.4,
  },
  msgName: {
    color: '#8b7bff',
    fontWeight: 600,
    marginRight: 6,
  },
  msgText: {
    wordBreak: 'break-word',
  },
  form: {
    display: 'flex',
    gap: 6,
    padding: 8,
    borderTop: '1px solid #2a1f4a',
  },
  input: {
    flex: 1,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #2a1f4a',
    background: '#0a0410',
    color: '#efe7ff',
    fontSize: 13,
  },
  send: {
    padding: '8px 12px',
    borderRadius: 8,
    border: 'none',
    background: '#8b7bff',
    color: '#0a0410',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
  },
  toggle: {
    padding: '10px 16px',
    borderRadius: 999,
    border: '1px solid #2a1f4a',
    background: '#150a24',
    color: '#efe7ff',
    fontSize: 13,
    cursor: 'pointer',
  },
};
