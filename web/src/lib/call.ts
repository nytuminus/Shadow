// Gerenciador de chamada WebRTC em malha (mesh). Cada participante mantém uma
// RTCPeerConnection direta com cada outro. O servidor só apresenta os pares;
// áudio/vídeo/tela vão peer-to-peer.
//
// Usa "perfect negotiation" (padrão da spec WebRTC): resolve colisões de
// oferta sem travar, com um lado "educado" e outro "grosso" definidos de forma
// determinística pelo id. Assim câmera/tela podem ligar e desligar a qualquer
// momento (renegociação) sem quebrar a chamada.

import type { Signaling } from './signaling';

interface PeerConn {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remoteStream: MediaStream;
  videoSender: RTCRtpSender | null;
}

export interface CallState {
  muted: boolean;
  video: boolean;
  screen: boolean;
}

type StreamCb = (peerId: string, stream: MediaStream) => void;
type RemoveCb = (peerId: string) => void;
type LocalCb = (stream: MediaStream | null, state: CallState) => void;
type StateCb = (state: CallState) => void;

export class CallManager {
  private peers = new Map<string, PeerConn>();
  private localStream: MediaStream | null = null; // microfone
  private camTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private iceServers: RTCIceServer[];
  channelId: string | null = null;
  state: CallState = { muted: false, video: false, screen: false };

  onPeerStream: StreamCb | null = null;
  onPeerRemoved: RemoveCb | null = null;
  onLocalStream: LocalCb | null = null;
  onState: StateCb | null = null;
  onSpeaking: ((ids: Set<string>) => void) | null = null;

  // Detecção de quem está falando (glow nos tiles/pod).
  private audioCtx: AudioContext | null = null;
  private analysers = new Map<string, { node: AnalyserNode; data: Uint8Array }>();
  private speaking = new Set<string>();
  private speakSince = new Map<string, number>();
  private rafId = 0;

  constructor(private signaling: Signaling, iceServers: RTCIceServer[]) {
    this.iceServers = iceServers;
    this.attach();
  }

  private attach() {
    this.signaling.on('voice-peers', (m) => {
      if (m.channelId !== this.channelId) return;
      for (const p of m.peers as { id: string }[]) this.createPeer(p.id);
    });
    this.signaling.on('peer-joined', (m) => {
      if (m.channelId !== this.channelId) return;
      this.createPeer(m.peer.id);
    });
    this.signaling.on('peer-left', (m) => this.removePeer(m.peerId));
    this.signaling.on('signal', (m) => this.onSignal(m.from, m.data));
  }

  // ---------- Entrar / sair ----------
  async join(channelId: string) {
    if (this.channelId) await this.leave();
    this.channelId = channelId;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (this.state.muted) this.localStream.getAudioTracks().forEach((t) => (t.enabled = false));
    } catch {
      this.localStream = null; // sem microfone: entra só ouvindo
    }
    this.signaling.rejoin = { channelId, state: this.state };
    this.signaling.send({ type: 'join-voice', channelId, state: this.state });
    if (this.localStream) this.addAnalyser('self', this.localStream);
    this.emitLocal();
    this.onState?.(this.state);
  }

  async leave() {
    this.signaling.send({ type: 'leave-voice' });
    this.signaling.rejoin = null;
    this.teardownAudio();
    for (const [id, e] of this.peers) { try { e.pc.close(); } catch { /* */ } this.onPeerRemoved?.(id); }
    this.peers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.camTrack?.stop();
    this.screenTrack?.stop();
    this.localStream = null; this.camTrack = null; this.screenTrack = null;
    this.channelId = null;
    this.state = { muted: false, video: false, screen: false };
    this.onLocalStream?.(null, this.state);
    this.onState?.(this.state);
  }

  private currentVideoTrack(): MediaStreamTrack | null {
    return this.screenTrack || this.camTrack || null;
  }

  // ---------- Malha de pares ----------
  private createPeer(peerId: string): PeerConn {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const selfId = this.signaling.selfId || '';
    const entry: PeerConn = {
      pc,
      polite: selfId < peerId, // exatamente um dos lados é "educado"
      makingOffer: false,
      ignoreOffer: false,
      remoteStream: new MediaStream(),
      videoSender: null,
    };

    if (this.localStream) {
      for (const t of this.localStream.getAudioTracks()) pc.addTrack(t, this.localStream);
    }
    // Vaga de vídeo fixa (câmera OU tela) — evita renegociar ao ligar/desligar.
    const vt = pc.addTransceiver('video', { direction: 'sendrecv' });
    entry.videoSender = vt.sender;
    const cur = this.currentVideoTrack();
    if (cur) vt.sender.replaceTrack(cur);

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(peerId, { description: pc.localDescription });
      } catch (err) {
        console.error('[call] negotiation', err);
      } finally {
        entry.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peerId, { candidate });
    };
    pc.ontrack = (ev) => {
      entry.remoteStream.addTrack(ev.track);
      this.onPeerStream?.(peerId, entry.remoteStream);
      if (ev.track.kind === 'audio') this.addAnalyser(peerId, entry.remoteStream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch { /* */ } }
    };

    this.peers.set(peerId, entry);
    return entry;
  }

  private removePeer(peerId: string) {
    const e = this.peers.get(peerId);
    if (!e) return;
    try { e.pc.close(); } catch { /* */ }
    this.peers.delete(peerId);
    this.analysers.delete(peerId);
    this.onPeerRemoved?.(peerId);
  }

  // ---------- Detecção de fala ----------
  private addAnalyser(key: string, stream: MediaStream) {
    if (this.analysers.has(key)) return;
    if (stream.getAudioTracks().length === 0) return;
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.startLevelLoop();
      }
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
      const src = this.audioCtx.createMediaStreamSource(stream);
      const node = this.audioCtx.createAnalyser();
      node.fftSize = 512;
      node.smoothingTimeConstant = 0.82;
      src.connect(node);
      this.analysers.set(key, { node, data: new Uint8Array(node.frequencyBinCount) });
    } catch { /* navegador sem WebAudio: sem glow, sem drama */ }
  }

  private startLevelLoop() {
    const loop = () => {
      let changed = false;
      const now = performance.now();
      for (const [key, a] of this.analysers) {
        a.node.getByteTimeDomainData(a.data);
        let sum = 0;
        for (let i = 0; i < a.data.length; i++) { const v = (a.data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / a.data.length);
        const id = key === 'self' ? (this.signaling.selfId || 'self') : key;
        const talking = rms > 0.05 && !(key === 'self' && this.state.muted);
        if (talking) {
          this.speakSince.set(id, now);
          if (!this.speaking.has(id)) { this.speaking.add(id); changed = true; }
        } else if (this.speaking.has(id) && now - (this.speakSince.get(id) || 0) > 300) {
          this.speaking.delete(id); changed = true;
        }
      }
      if (changed) this.onSpeaking?.(new Set(this.speaking));
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private teardownAudio() {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.analysers.clear();
    this.speaking.clear();
    this.speakSince.clear();
    try { this.audioCtx?.close(); } catch { /* */ }
    this.audioCtx = null;
    this.onSpeaking?.(new Set());
  }

  private signal(to: string, data: any) {
    this.signaling.send({ type: 'signal', to, data });
  }

  private async onSignal(from: string, data: any) {
    if (!this.channelId) return;
    const entry = this.createPeer(from);
    const { pc } = entry;
    try {
      if (data.description) {
        const collision =
          data.description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && collision;
        if (entry.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          this.signal(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch (err) { if (!entry.ignoreOffer) throw err; }
      }
    } catch (err) {
      console.error('[call] signal', err);
    }
  }

  // ---------- Controles ----------
  toggleMute() {
    this.state.muted = !this.state.muted;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !this.state.muted));
    this.sendState();
  }

  async setCamera(on: boolean) {
    if (on) {
      if (this.screenTrack) await this.setScreen(false); // vaga única de vídeo
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      this.camTrack = s.getVideoTracks()[0];
      this.camTrack.onended = () => this.setCamera(false);
      this.state.video = true;
    } else {
      this.camTrack?.stop();
      this.camTrack = null;
      this.state.video = false;
    }
    this.applyVideoToAll();
    this.emitLocal();
    this.sendState();
  }

  async setScreen(on: boolean) {
    if (on) {
      if (this.camTrack) await this.setCamera(false);
      const s = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: true });
      this.screenTrack = s.getVideoTracks()[0];
      this.screenTrack.onended = () => this.setScreen(false);
      this.state.screen = true;
    } else {
      this.screenTrack?.stop();
      this.screenTrack = null;
      this.state.screen = false;
    }
    this.applyVideoToAll();
    this.emitLocal();
    this.sendState();
  }

  private applyVideoToAll() {
    const track = this.currentVideoTrack();
    for (const e of this.peers.values()) {
      try { e.videoSender?.replaceTrack(track); } catch { /* */ }
    }
  }

  private emitLocal() {
    const track = this.currentVideoTrack();
    const stream = track ? new MediaStream([track]) : null;
    this.onLocalStream?.(stream, this.state);
  }

  private sendState() {
    this.signaling.send({ type: 'state', state: this.state });
    if (this.signaling.rejoin) this.signaling.rejoin.state = this.state;
    this.onState?.(this.state);
  }
}
