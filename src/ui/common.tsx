import type { ReactNode } from 'react';
import { RES_KEYS } from '../engine/config';
import type { CampaignState, Resources } from '../engine/types';

export const RES_ICON: Record<keyof Resources, string> = { money: '$', oil: '⛽', iron: '⛏', gold: '◆', energy: '⚡' };
export const RES_COLOR: Record<keyof Resources, string> = {
  money: 'text-[#d7e3a8]', oil: 'text-[#c9c3b3]', iron: 'text-[#a9b7c4]', gold: 'text-[#e3c35a]', energy: 'text-[#e6d36f]',
};

export function fmt(n: number) {
  const a = Math.abs(n);
  if (a >= 100000) return `${Math.round(n / 1000)}k`;
  if (a >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return Math.floor(n).toString();
}

export function rate(n: number) {
  const v = n * 60;
  return `${v >= 0 ? '+' : ''}${Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)}/min`;
}

export function timeLeft(s: CampaignState, at: number | null | undefined) {
  if (at == null) return '';
  const sec = Math.max(0, (at - s.gameTime) / s.settings.speed);
  if (sec < 60) return `${Math.ceil(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.ceil(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export function Cost({ cost, have }: { cost: Partial<Resources>; have?: Resources }) {
  const items = RES_KEYS.filter((k) => (cost[k] ?? 0) > 0);
  if (!items.length) return <span className="text-stone-400">free</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2">
      {items.map((k) => {
        const short = have && have[k] + 1e-9 < (cost[k] ?? 0);
        return (
          <span key={k} className={short ? 'text-[#e0533f]' : RES_COLOR[k]}>
            {RES_ICON[k]}
            {Math.round(cost[k]!)}
          </span>
        );
      })}
    </span>
  );
}

export function Btn({ children, onClick, disabled, kind = 'primary', className = '', title }: { children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'primary' | 'ghost' | 'danger' | 'warn'; className?: string; title?: string }) {
  const k = {
    primary: 'bg-[#56662d] hover:bg-[#667a35] text-[#eef2dc] border-[#7a8f3a]',
    ghost: 'bg-[#2a2e26] hover:bg-[#353a30] text-stone-200 border-[#40463a]',
    danger: 'bg-[#6b2e28] hover:bg-[#80372f] text-[#f6dcd6] border-[#a3483f]',
    warn: 'bg-[#6b5a28] hover:bg-[#7d6a2f] text-[#f6ecd0] border-[#b0903a]',
  }[kind];
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded border ${k} disabled:opacity-40 disabled:cursor-not-allowed active:translate-y-px transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[11px] tracking-[0.18em] uppercase text-[#a8b37a]">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Bar({ value, color = '#a8b37a' }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 bg-[#1b1e19] rounded overflow-hidden">
      <div className="h-full transition-[width] duration-500" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span className="text-stone-400">{label}</span>
      <span className="text-right text-stone-100">{children}</span>
    </div>
  );
}

export function Card({ children, onClick, active, className = '' }: { children: ReactNode; onClick?: () => void; active?: boolean; className?: string }) {
  return (
    <div
      onClick={onClick}
      className={`rounded border px-3 py-2 mb-2 ${active ? 'border-[#a8b37a] bg-[#2f3528]' : 'border-[#3a4034] bg-[#23271f]'} ${onClick ? 'cursor-pointer hover:border-[#7a8f3a]' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
