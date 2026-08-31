import { useState, type CSSProperties, type FormEvent } from 'react';
import { login } from '../net/api.js';
import { saveSession, type Session } from '../net/session.js';

export function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(username, password);
      saveSession(result);
      onLogin(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>SHADOW</h1>
        <p style={styles.subtitle}>Escritório</p>
        <input
          style={styles.input}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="usuário"
          autoFocus
          autoComplete="username"
        />
        <input
          style={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="senha"
          type="password"
          autoComplete="current-password"
        />
        {error && <p style={styles.error}>{error}</p>}
        <button style={styles.button} type="submit" disabled={loading || !username || !password}>
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0a0410',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    width: 300,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 32,
    borderRadius: 16,
    background: '#150a24',
    border: '1px solid #2a1f4a',
  },
  title: {
    margin: 0,
    color: '#efe7ff',
    fontSize: 28,
    letterSpacing: 4,
    textAlign: 'center',
  },
  subtitle: {
    margin: '0 0 12px',
    color: '#8b7bff',
    textAlign: 'center',
    fontSize: 13,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  input: {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #2a1f4a',
    background: '#0a0410',
    color: '#efe7ff',
    fontSize: 14,
  },
  error: {
    margin: 0,
    color: '#ff6b6b',
    fontSize: 13,
  },
  button: {
    padding: '10px 12px',
    borderRadius: 8,
    border: 'none',
    background: '#8b7bff',
    color: '#0a0410',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
};
