import { initials } from '../lib/identity';

export function Avatar({ name, color, size = 40, className = '' }: {
  name: string; color?: string; size?: number; className?: string;
}) {
  const bg = color || '#8b7bff';
  return (
    <div
      className={className}
      style={{
        width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center',
        fontWeight: 700, color: '#0a0410', fontSize: size * 0.4,
        background: `linear-gradient(140deg, ${bg}, ${shade(bg, -30)})`,
      }}
    >
      {initials(name || '?')}
    </div>
  );
}

// Escurece/clareia uma cor hex para o degradê do avatar.
function shade(hex: string, amt: number): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return hex;
  const num = parseInt(m, 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
