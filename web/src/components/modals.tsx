import { useState } from 'react';
import { PALETTE } from '../lib/identity';
import type { User } from '../lib/types';

export function IdentityModal({ initial, onSave }: { initial: User; onSave: (u: User) => void }) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color || PALETTE[0]);
  return (
    <div className="overlay">
      <form
        className="modal"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave({ ...initial, name: name.trim(), color }); }}
      >
        <h2>Bem-vindo às Salas</h2>
        <p>Como o time vai te ver nas conversas e chamadas?</p>
        <div className="field">
          <label>Seu nome</label>
          <input autoFocus value={name} maxLength={32} placeholder="ex.: Thiago" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Sua cor</label>
          <div className="swatches">
            {PALETTE.map((c) => (
              <button type="button" key={c} className={`swatch ${c === color ? 'sel' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn primary" type="submit" disabled={!name.trim()}>Entrar</button>
        </div>
      </form>
    </div>
  );
}

const ICONS = ['🏢', '💬', '🎮', '🚀', '💜', '🛠️', '📊', '🎧', '☕', '🔥', '🌙', '⚡'];

export function NewRoomModal({ onClose, onCreate }: { onClose: () => void; onCreate: (d: { name: string; icon: string; color: string }) => void }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(ICONS[0]);
  const [color, setColor] = useState(PALETTE[0]);
  return (
    <div className="overlay" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate({ name: name.trim(), icon, color }); }}
      >
        <h2>Nova sala</h2>
        <p>Um espaço da empresa com seus próprios canais de texto e voz.</p>
        <div className="field">
          <label>Nome</label>
          <input autoFocus value={name} maxLength={40} placeholder="ex.: Time de Produto" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Ícone</label>
          <div className="emoji-row">
            {ICONS.map((i) => (
              <button type="button" key={i} className={`emoji-pick ${i === icon ? 'sel' : ''}`} onClick={() => setIcon(i)}>{i}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Cor</label>
          <div className="swatches">
            {PALETTE.map((c) => (
              <button type="button" key={c} className={`swatch ${c === color ? 'sel' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" type="submit" disabled={!name.trim()}>Criar sala</button>
        </div>
      </form>
    </div>
  );
}

export function NewChannelModal({ onClose, onCreate }: { onClose: () => void; onCreate: (d: { name: string; type: 'text' | 'voice' }) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'text' | 'voice'>('text');
  return (
    <div className="overlay" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate({ name: name.trim(), type }); }}
      >
        <h2>Novo canal</h2>
        <p>Canais de texto para conversar; canais de voz para chamadas com vídeo e tela.</p>
        <div className="field">
          <label>Tipo</label>
          <div className="seg">
            <button type="button" className={type === 'text' ? 'sel' : ''} onClick={() => setType('text')}># Texto</button>
            <button type="button" className={type === 'voice' ? 'sel' : ''} onClick={() => setType('voice')}>🔊 Voz</button>
          </div>
        </div>
        <div className="field">
          <label>Nome</label>
          <input autoFocus value={name} maxLength={40} placeholder={type === 'voice' ? 'ex.: Sala de Reunião' : 'ex.: geral'} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" type="submit" disabled={!name.trim()}>Criar canal</button>
        </div>
      </form>
    </div>
  );
}
