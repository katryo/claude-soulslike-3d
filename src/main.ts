import { Game } from './Game';

const app = document.getElementById('app')!;
const boot = document.getElementById('boot');

function fail(msg: string): void {
  if (boot) {
    boot.textContent = msg;
    boot.classList.add('error');
  }
}

async function main(): Promise<void> {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('viewer')) {
    const { runViewer } = await import('./debug/Viewer');
    boot?.remove();
    runViewer(app);
    return;
  }
  const game = new Game(app);
  game.start();
  boot?.remove();
  // Exposed for debugging and automated smoke tests.
  (window as unknown as { game: Game }).game = game;
}

main().catch((e) => {
  console.error(e);
  fail('WebGL is required to play Ashen Hollow. ' + (e instanceof Error ? e.message : ''));
});
