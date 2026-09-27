// Dev-only hook for scripted checks (window.__divesim; not included in production builds).
import { advance } from './loop';
import { refresh } from './render';
import { renderControls } from './settings';
import { app, computers, session } from './state';

export function installDevHook(): void {
  const hook = {
    session,
    computers,
    advance,
    refresh,
    select: (id: string) => {
      app.active = computers.find((c) => c.id === id) ?? app.active;
      renderControls();
      refresh(true);
    },
  };
  // Layout checker (see CLAUDE.md): __divesim.layout.checkLayout(), .sweep([...states]), .show(state, id).
  void import('../dev/layoutCheck').then((m) => {
    Object.assign(hook, {
      layout: {
        checkLayout: m.checkLayout,
        states: Object.keys(m.diveStates(hook)),
        sweep: (states: string[], only?: string) => m.sweep(hook, states, only),
        show: (state: string, id: string, opts?: Parameters<typeof m.show>[3]) => m.show(hook, state, id, opts),
      },
    });
  });
  (window as unknown as Record<string, unknown>).__divesim = hook;
}
