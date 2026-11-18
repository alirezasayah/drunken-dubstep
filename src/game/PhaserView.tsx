import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import { store, useStore } from '../store';
import { BattleScene } from './BattleScene';
import { WorldScene } from './WorldScene';

export function PhaserView() {
  const ref = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);
  const { ui } = useStore();

  useEffect(() => {
    if (!ref.current || game.current) return;
    game.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: ref.current,
      backgroundColor: '#20241d',
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      input: { activePointers: 3 },
      render: { antialias: true, roundPixels: false },
      scene: [],
      banner: false,
    });
    (window as any).__frontline = { game: game.current, store };
    game.current.scene.add('world', WorldScene, false);
    game.current.scene.add('battle', BattleScene, false);
    const start = () => {
      if (store.ui.battleId) game.current!.scene.start('battle');
      else game.current!.scene.start('world');
    };
    if (game.current.isBooted) start();
    else game.current.events.once('ready', start);
    return () => {
      game.current?.destroy(true);
      game.current = null;
    };
  }, []);

  useEffect(() => {
    const g = game.current;
    if (!g || !g.isBooted) return;
    if (ui.battleId) {
      if (g.scene.isActive('world')) g.scene.stop('world');
      g.scene.stop('battle');
      g.scene.start('battle');
    } else {
      if (g.scene.isActive('battle')) g.scene.stop('battle');
      if (!g.scene.isActive('world')) g.scene.start('world');
    }
  }, [ui.battleId, ui.campaignId]);

  return <div ref={ref} className="absolute inset-0 touch-none select-none" />;
}
