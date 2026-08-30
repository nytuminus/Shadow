import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api';
import { Signaling } from './lib/signaling';
import { CallManager, type CallState } from './lib/call';
import { loadUser, saveUser } from './lib/identity';
import type { ChatMessage, Presence, Room, User } from './lib/types';
import { Avatar } from './components/Avatar';
import { VideoTile } from './components/VideoTile';
import { IdentityModal, NewRoomModal, NewChannelModal } from './components/modals';

type ModuleId = 'shadow' | 'salas' | 'jogos';

export default function App() {
  const [user, setUser] = useState<User>(() => loadUser());
  const [needsIdentity, setNeedsIdentity] = useState(false);
  const [module, setModule] = useState<ModuleId>('shadow');

  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [viewChannelId, setViewChannelId] = useState<string | null>(null);
  const [presence, setPresence] = useState<Presence>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [selfId, setSelfId] = useState<string | null>(null);

  // Chamada (vive no nível do shell → persiste ao trocar de módulo).
  const [callChannelId, setCallChannelId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [callState, setCallState] = useState<CallState>({ muted: false, video: false, screen: false });
  const [remote, setRemote] = useState<Map<string, MediaStream>>(new Map());
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());

  const [showNewRoom, setShowNewRoom] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);

  const sig = useRef<Signaling | null>(null);
  const call = useRef<CallManager | null>(null);
  const assistantRef = useRef<HTMLIFrameElement>(null);
  const viewChannelRef = useRef<string | null>(null);
  viewChannelRef.current = viewChannelId;

  const activeRoom = useMemo(() => rooms.find((r) => r.id === activeRoomId) || null, [rooms, activeRoomId]);
  const viewChannel = useMemo(
    () => activeRoom?.channels.find((c) => c.id === viewChannelId) || null,
    [activeRoom, viewChannelId]
  );
  const callChannel = useMemo(() => {
    for (const r of rooms) { const c = r.channels.find((x) => x.id === callChannelId); if (c) return c; }
    return null;
  }, [rooms, callChannelId]);

  // ---- Salas: dados ----
  async function refreshRooms(selectFirst = false) {
    const list = await api.rooms();
    setRooms(list);
    if (selectFirst && list.length && !activeRoomId) {
      setActiveRoomId(list[0].id);
      const firstText = list[0].channels.find((c) => c.type === 'text') || list[0].channels[0];
      if (firstText) setViewChannelId(firstText.id);
    }
    return list;
  }
  useEffect(() => { refreshRooms(true).catch(console.error); }, []);

  // ---- Tempo real (conecta como convidado; identidade entra depois) ----
  useEffect(() => {
    if (sig.current) return;
    const s = new Signaling();
    sig.current = s;
    s.on('open', () => setConnected(true));
    s.on('close', () => setConnected(false));
    s.on('welcome', (m) => { setSelfId(m.selfId); setPresence(m.presence || {}); });
    s.on('presence', (m) => setPresence(m.presence || {}));
    s.on('chat', (m) => {
      const msg: ChatMessage = m.message;
      if (msg.channelId === viewChannelRef.current) setMessages((prev) => [...prev, msg]);
    });
    s.connect(user);

    api.rtcConfig().then((cfg) => {
      const cm = new CallManager(s, cfg.iceServers);
      cm.onLocalStream = (stream, st) => { setLocalStream(stream); setCallState(st); };
      cm.onState = (st) => setCallState({ ...st });
      cm.onPeerStream = (pid, stream) => setRemote((prev) => new Map(prev).set(pid, stream));
      cm.onPeerRemoved = (pid) => setRemote((prev) => { const n = new Map(prev); n.delete(pid); return n; });
      cm.onSpeaking = (ids) => setSpeaking(ids);
      call.current = cm;
    });
    return () => { s.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Alterna o app do assistente entre robô e Jogos ----
  useEffect(() => {
    const w = assistantRef.current?.contentWindow;
    if (!w) return;
    if (module === 'jogos') w.postMessage('shadow:show-games', '*');
    if (module === 'shadow') w.postMessage('shadow:show-assistant', '*');
  }, [module]);

  // ---- Histórico ao abrir canal de texto ----
  useEffect(() => {
    if (!viewChannel || viewChannel.type !== 'text') { setMessages([]); return; }
    let live = true;
    api.messages(viewChannel.id).then((m) => { if (live) setMessages(m); }).catch(() => {});
    return () => { live = false; };
  }, [viewChannel?.id]);

  // ---- Ações ----
  function goSalas() {
    setModule('salas');
    if (!user.name) setNeedsIdentity(true);
  }
  function saveIdentity(u: User) {
    saveUser(u); setUser(u); setNeedsIdentity(false); sig.current?.updateUser(u);
  }
  function openRoom(room: Room) {
    setActiveRoomId(room.id);
    const firstText = room.channels.find((c) => c.type === 'text') || room.channels[0] || null;
    setViewChannelId(firstText ? firstText.id : null);
  }
  async function joinVoice(channelId: string) {
    if (!user.name) { setNeedsIdentity(true); return; }
    setViewChannelId(channelId);          // mostra o palco da chamada
    if (callChannelId === channelId) return; // já estou nesta call
    await call.current?.join(channelId);
    setCallChannelId(channelId);
  }
  async function leaveVoice() {
    await call.current?.leave();
    setCallChannelId(null); setRemote(new Map()); setLocalStream(null);
  }
  function sendChat(text: string) {
    if (!viewChannel) return;
    if (!user.name) { setNeedsIdentity(true); return; }
    sig.current?.send({ type: 'chat', channelId: viewChannel.id, text });
  }
  async function createRoom(d: { name: string; icon: string; color: string }) {
    const room = await api.createRoom(d);
    setShowNewRoom(false);
    const list = await refreshRooms();
    const full = list.find((r) => r.id === room.id);
    if (full) openRoom(full);
  }
  async function createChannel(d: { name: string; type: 'text' | 'voice' }) {
    if (!activeRoomId) return;
    await api.createChannel(activeRoomId, d);
    setShowNewChannel(false);
    await refreshRooms();
  }
  async function removeChannel(id: string) {
    if (!confirm('Apagar este canal e seu histórico?')) return;
    if (callChannelId === id) await leaveVoice();
    await api.deleteChannel(id);
    if (viewChannelId === id) setViewChannelId(null);
    await refreshRooms();
  }

  const viewingCall = module === 'salas' && callChannelId != null && viewChannelId === callChannelId;
  const showPod = callChannelId != null && !viewingCall;

  return (
    <div className="shell">
      <ModuleDock
        module={module}
        inCall={!!callChannelId}
        connected={connected}
        user={user}
        onShadow={() => setModule('shadow')}
        onJogos={() => setModule('jogos')}
        onSalas={goSalas}
        onEditIdentity={() => setNeedsIdentity(true)}
      />

      <div className="shell-body">
        {/* Salas (nativo) — sempre montado, escondido quando inativo. */}
        <div className="view salas-view" style={{ display: module === 'salas' ? 'grid' : 'none' }}>
          {activeRoom ? (
            <SalasPanel
              rooms={rooms}
              room={activeRoom}
              viewChannelId={viewChannelId}
              callChannelId={callChannelId}
              presence={presence}
              onOpenRoom={openRoom}
              onNewRoom={() => setShowNewRoom(true)}
              onSelect={setViewChannelId}
              onJoinVoice={joinVoice}
              onNewChannel={() => setShowNewChannel(true)}
              onDeleteChannel={removeChannel}
            />
          ) : (
            <div className="salas-panel" style={{ display: 'grid', placeItems: 'center' }}><span className="center-note">nenhuma sala</span></div>
          )}

          <main className="main">
            {!viewChannel ? (
              <div className="center-note" style={{ margin: 'auto' }}>Escolha um canal.</div>
            ) : viewChannel.type === 'text' ? (
              <ChatPane channel={viewChannel} messages={messages} onSend={sendChat} />
            ) : (
              <CallPane
                channelName={viewChannel.name}
                inThisCall={callChannelId === viewChannel.id}
                selfId={selfId}
                user={user}
                presence={presence[viewChannel.id] || []}
                remote={remote}
                localStream={localStream}
                callState={callState}
                speaking={speaking}
                onJoin={() => joinVoice(viewChannel.id)}
                onLeave={leaveVoice}
                onToggleMute={() => call.current?.toggleMute()}
                onToggleCam={() => call.current?.setCamera(!callState.video)}
                onToggleScreen={() => call.current?.setScreen(!callState.screen)}
              />
            )}
          </main>
        </div>

        {/* Assistente + Jogos: o app original, embutido e persistente. */}
        <iframe
          ref={assistantRef}
          title="Shadow"
          className="view assistant-frame"
          src="/assistant"
          allow="microphone; camera; display-capture; autoplay; clipboard-read; clipboard-write"
          style={{ display: module === 'shadow' || module === 'jogos' ? 'block' : 'none' }}
        />
      </div>

      {/* Pod flutuante da chamada — persiste sobre qualquer módulo. */}
      {showPod && (
        <CallPod
          channelName={callChannel?.name || 'chamada'}
          selfId={selfId}
          user={user}
          presence={presence[callChannelId!] || []}
          remote={remote}
          localStream={localStream}
          callState={callState}
          speaking={speaking}
          onExpand={() => { setModule('salas'); if (callChannel) { setActiveRoomId(findRoomOf(rooms, callChannelId!)); setViewChannelId(callChannelId); } }}
          onToggleMute={() => call.current?.toggleMute()}
          onToggleCam={() => call.current?.setCamera(!callState.video)}
          onToggleScreen={() => call.current?.setScreen(!callState.screen)}
          onLeave={leaveVoice}
        />
      )}

      <div className={`conn-dot ${connected ? 'ok' : ''}`}><span className="d" />{connected ? 'conectado' : 'reconectando…'}</div>

      {needsIdentity && <IdentityModal initial={user} onSave={saveIdentity} />}
      {showNewRoom && <NewRoomModal onClose={() => setShowNewRoom(false)} onCreate={createRoom} />}
      {showNewChannel && <NewChannelModal onClose={() => setShowNewChannel(false)} onCreate={createChannel} />}
    </div>
  );
}

/* ===================== Dock de módulos (nav da plataforma) ===================== */
function ModuleDock({ module, inCall, connected, user, onShadow, onJogos, onSalas, onEditIdentity }: {
  module: ModuleId; inCall: boolean; connected: boolean; user: User;
  onShadow: () => void; onJogos: () => void; onSalas: () => void; onEditIdentity: () => void;
}) {
  return (
    <nav className="mdock">
      <img className="mdock-logo" src="/logo.png" alt="Shadow" />
      <div className="mdock-items">
        <DockBtn active={module === 'shadow'} onClick={onShadow} icon="🤖" label="Shadow" tint="var(--v)" />
        <DockBtn active={module === 'salas'} onClick={onSalas} icon="💬" label="Salas" tint="var(--cyan)" badge={inCall ? 'call' : undefined} />
        <DockBtn active={module === 'jogos'} onClick={onJogos} icon="🎮" label="Jogos" tint="var(--gold, #ffcf5a)" />
      </div>
      <div className="mdock-spacer" />
      <button className="mdock-me" title="Meu perfil" onClick={onEditIdentity}>
        <span className="me-dot" style={{ background: connected ? 'var(--green)' : 'var(--ink-faint)' }} />
        <Avatar name={user.name || '?'} color={user.color} size={44} />
      </button>
    </nav>
  );
}
function DockBtn({ active, onClick, icon, label, tint, badge }: {
  active: boolean; onClick: () => void; icon: string; label: string; tint: string; badge?: string;
}) {
  return (
    <button className={`dock-btn ${active ? 'active' : ''}`} onClick={onClick} style={active ? { ['--tint' as any]: tint } : undefined}>
      <span className="glyph">{icon}</span>
      <span className="dock-lbl">{label}</span>
      {badge && <span className="dock-badge">●</span>}
    </button>
  );
}

/* ===================== Painel das Salas (rooms + canais) ===================== */
function SalasPanel({ rooms, room, viewChannelId, callChannelId, presence, onOpenRoom, onNewRoom, onSelect, onJoinVoice, onNewChannel, onDeleteChannel }: {
  rooms: Room[]; room: Room; viewChannelId: string | null; callChannelId: string | null; presence: Presence;
  onOpenRoom: (r: Room) => void; onNewRoom: () => void; onSelect: (id: string) => void; onJoinVoice: (id: string) => void;
  onNewChannel: () => void; onDeleteChannel: (id: string) => void;
}) {
  const text = room.channels.filter((c) => c.type === 'text');
  const voice = room.channels.filter((c) => c.type === 'voice');
  return (
    <aside className="salas-panel">
      <div className="panel-brand"><span className="pb-line" />SALAS<span className="pb-line" /></div>

      <div className="rooms-row">
        {rooms.map((r) => (
          <button key={r.id} className={`room-chip ${r.id === room.id ? 'sel' : ''}`} title={r.name}
            style={{ ['--rc' as any]: r.color }} onClick={() => onOpenRoom(r)}>
            <span>{r.icon}</span>
          </button>
        ))}
        <button className="room-chip add" title="Nova sala" onClick={onNewRoom}>+</button>
      </div>

      <div className="room-head" style={{ ['--rc' as any]: room.color }}>
        <span className="rh-ic">{room.icon}</span>
        <div><b>{room.name}</b><span>plataforma da equipe</span></div>
      </div>

      <div className="chan-scroll">
        <div className="chan-group">
          <div className="chan-group-h"><span>◆ texto</span><button title="Novo canal" onClick={onNewChannel}>+</button></div>
          {text.map((c) => (
            <button key={c.id} className={`chan ${c.id === viewChannelId ? 'active' : ''}`} onClick={() => onSelect(c.id)}>
              <span className="hash">#</span><span className="cname">{c.name}</span>
              <span className="del" title="Apagar" onClick={(e) => { e.stopPropagation(); onDeleteChannel(c.id); }}>✕</span>
            </button>
          ))}
        </div>
        <div className="chan-group">
          <div className="chan-group-h"><span>◆ voz &amp; vídeo</span></div>
          {voice.map((c) => {
            const members = presence[c.id] || [];
            const here = c.id === callChannelId;
            return (
              <div key={c.id} className={`vwrap ${here ? 'here' : ''}`}>
                <button className={`chan voice ${c.id === viewChannelId ? 'active' : ''}`} onClick={() => onJoinVoice(c.id)}>
                  <span className="hash">🔊</span><span className="cname">{c.name}</span>
                  {members.length > 0 && <span className="live"><span className="d" />{members.length}</span>}
                  <span className="del" title="Apagar" onClick={(e) => { e.stopPropagation(); onDeleteChannel(c.id); }}>✕</span>
                </button>
                {members.length > 0 && (
                  <div className="voice-members">
                    {members.map((m) => (
                      <div className="voice-member" key={m.id}>
                        <span className="mini-av" style={{ background: m.user.color || '#8b7bff' }}>{ini(m.user.name)}</span>
                        <span>{m.user.name}</span>
                        <span className="ic">{m.state.screen ? '🖥️' : m.state.video ? '📹' : ''}{m.state.muted ? '🔇' : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

/* ===================== Chat ===================== */
function ChatPane({ channel, messages, onSend }: { channel: { name: string }; messages: ChatMessage[]; onSend: (t: string) => void }) {
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages.length]);
  return (
    <div className="chat">
      <div className="main-head"><span className="hash">#</span><b>{channel.name}</b></div>
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && <div className="chat-empty"><div className="big">✦</div>Comece a conversa em <b>#{channel.name}</b>.</div>}
        {messages.map((m) => (
          <div className="msg" key={m.id}>
            <Avatar name={m.userName || '?'} className="av" size={40} />
            <div className="body">
              <div className="meta"><b>{m.userName || 'Convidado'}</b><time>{fmtTime(m.createdAt)}</time></div>
              <div className="text">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <form onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) { onSend(t); setText(''); } }}>
          <input value={text} placeholder={`Mensagem em #${channel.name}`} maxLength={2000} onChange={(e) => setText(e.target.value)} />
          <button type="submit">Enviar</button>
        </form>
      </div>
    </div>
  );
}

/* ===================== Palco da chamada (inline) ===================== */
function CallPane(props: {
  channelName: string; inThisCall: boolean; selfId: string | null; user: User;
  presence: { id: string; user: User; state: any }[]; remote: Map<string, MediaStream>;
  localStream: MediaStream | null; callState: CallState; speaking: Set<string>;
  onJoin: () => void; onLeave: () => void; onToggleMute: () => void; onToggleCam: () => void; onToggleScreen: () => void;
}) {
  const { channelName, inThisCall, selfId, user, presence, remote, localStream, callState, speaking } = props;
  return (
    <div className="chat">
      <div className="main-head"><span className="hash">🔊</span><b>{channelName}</b><div className="spacer" /><span className="pill">{presence.length} na chamada</span></div>
      <div className="stage">
        {!inThisCall ? (
          <div className="join-card">
            <div className="ic">🎧</div>
            <h2>{channelName}</h2>
            <p>{presence.length ? `${presence.length} pessoa(s) na chamada agora.` : 'Ninguém aqui ainda — seja o primeiro.'}</p>
            <button className="btn-join" onClick={props.onJoin}>Entrar na chamada</button>
          </div>
        ) : (
          <>
            <div className={`tiles count-${Math.min(presence.length, 4)}`}>
              {presence.map((p) => {
                const isSelf = p.id === selfId;
                return <VideoTile key={p.id} user={isSelf ? user : p.user} state={isSelf ? callState : p.state} stream={isSelf ? localStream : remote.get(p.id) || null} isSelf={isSelf} speaking={speaking.has(p.id)} />;
              })}
            </div>
            <CallControls callState={callState} onToggleMute={props.onToggleMute} onToggleCam={props.onToggleCam} onToggleScreen={props.onToggleScreen} onLeave={props.onLeave} />
          </>
        )}
      </div>
    </div>
  );
}

function CallControls({ callState, onToggleMute, onToggleCam, onToggleScreen, onLeave }: {
  callState: CallState; onToggleMute: () => void; onToggleCam: () => void; onToggleScreen: () => void; onLeave: () => void;
}) {
  return (
    <div className="callbar">
      <button className={`cbtn ${callState.muted ? 'danger-active' : 'on'}`} title={callState.muted ? 'Ativar microfone' : 'Silenciar'} onClick={onToggleMute}>{callState.muted ? '🔇' : '🎤'}</button>
      <button className={`cbtn ${callState.video ? 'on' : ''}`} title="Câmera" onClick={onToggleCam}>{callState.video ? '📹' : '📷'}</button>
      <button className={`cbtn ${callState.screen ? 'on' : ''}`} title="Compartilhar tela" onClick={onToggleScreen}>🖥️</button>
      <button className="cbtn leave" title="Sair" onClick={onLeave}>Sair</button>
    </div>
  );
}

/* ===================== Pod flutuante (chamada persistente) ===================== */
const POD_W = 328;
function CallPod(props: {
  channelName: string; selfId: string | null; user: User;
  presence: { id: string; user: User; state: any }[]; remote: Map<string, MediaStream>;
  localStream: MediaStream | null; callState: CallState; speaking: Set<string>;
  onExpand: () => void; onToggleMute: () => void; onToggleCam: () => void; onToggleScreen: () => void; onLeave: () => void;
}) {
  const { channelName, selfId, user, presence, remote, localStream, callState, speaking } = props;
  const [min, setMin] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try { const s = JSON.parse(localStorage.getItem('shadow.pod.pos') || ''); if (s && typeof s.x === 'number') return s; } catch { /* */ }
    return { x: window.innerWidth - POD_W - 24, y: window.innerHeight - 380 };
  });
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const w = min ? 168 : POD_W;

  // Fala em destaque: quem está falando (o próprio ou um par) ilumina a bolha.
  const someoneTalking = presence.some((p) => speaking.has(p.id));
  const speaker = presence.find((p) => speaking.has(p.id)) || presence[0];

  function clamp(x: number, y: number) {
    return {
      x: Math.max(8, Math.min(window.innerWidth - w - 8, x)),
      y: Math.max(8, Math.min(window.innerHeight - 90, y)),
    };
  }
  function onDown(e: React.PointerEvent) {
    // Não arrastar quando o clique é num botão do cabeçalho — senão o
    // pointer-capture engole o clique dos controles.
    if ((e.target as HTMLElement).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return;
    drag.current.moved = true;
    setPos(clamp(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  }
  function onUp() {
    if (!drag.current) return;
    if (drag.current.moved) {
      // Encaixe no canto horizontal mais próximo (só se arrastou).
      const snapX = pos.x + w / 2 < window.innerWidth / 2 ? 24 : window.innerWidth - w - 24;
      const snapped = clamp(snapX, pos.y);
      setPos(snapped);
      try { localStorage.setItem('shadow.pod.pos', JSON.stringify(snapped)); } catch { /* */ }
    }
    drag.current = null;
  }

  if (min) {
    return (
      <div className={`call-pod mini ${someoneTalking ? 'talk' : ''}`} style={{ left: pos.x, top: pos.y, width: w }}>
        <div className="pod-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          <span className="pod-live"><span className="d" /></span>
          <Avatar name={speaker?.user.name || user.name} color={speaker?.user.color || user.color} size={26} />
          <span className="pod-name">{presence.length} na call</span>
          <button className="pod-x" title="Ampliar" onClick={() => setMin(false)}>▣</button>
        </div>
        <div className="pod-bar">
          <button className={`cbtn sm ${callState.muted ? 'danger-active' : 'on'}`} onClick={props.onToggleMute}>{callState.muted ? '🔇' : '🎤'}</button>
          <button className="cbtn sm leave" onClick={props.onLeave}>Sair</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`call-pod ${someoneTalking ? 'talk' : ''}`} style={{ left: pos.x, top: pos.y, width: w }}>
      <div className="pod-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <span className="pod-live"><span className="d" /> NA CHAMADA</span>
        <span className="pod-name">{channelName}</span>
        <button className="pod-x" title="Minimizar" onClick={() => setMin(true)}>▁</button>
        <button className="pod-x" title="Expandir" onClick={props.onExpand}>⤢</button>
      </div>
      <div className="pod-tiles">
        {presence.slice(0, 4).map((p) => {
          const isSelf = p.id === selfId;
          return <VideoTile key={p.id} user={isSelf ? user : p.user} state={isSelf ? callState : p.state} stream={isSelf ? localStream : remote.get(p.id) || null} isSelf={isSelf} speaking={speaking.has(p.id)} />;
        })}
      </div>
      <div className="pod-bar">
        <button className={`cbtn sm ${callState.muted ? 'danger-active' : 'on'}`} onClick={props.onToggleMute}>{callState.muted ? '🔇' : '🎤'}</button>
        <button className={`cbtn sm ${callState.video ? 'on' : ''}`} onClick={props.onToggleCam}>{callState.video ? '📹' : '📷'}</button>
        <button className={`cbtn sm ${callState.screen ? 'on' : ''}`} onClick={props.onToggleScreen}>🖥️</button>
        <button className="cbtn sm leave" onClick={props.onLeave}>Sair</button>
      </div>
    </div>
  );
}

/* ===================== utils ===================== */
function ini(name: string) {
  const p = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function findRoomOf(rooms: Room[], channelId: string): string | null {
  for (const r of rooms) if (r.channels.some((c) => c.id === channelId)) return r.id;
  return null;
}
