'use client';

import { useEffect, useRef } from 'react';

// Coalesce focus + visibility events, skip hidden-tab polling, and never
// overlap this component's refreshes. Page input changes still load immediately.
export function useVisibleRefresh(refresh: () => Promise<unknown>, events: string[] = [], intervalMs = 30000) {
  const current = useRef(refresh);
  useEffect(() => { current.current = refresh; }, [refresh]);
  const eventKey = events.join(',');
  useEffect(() => {
    let running = false;
    let lastStarted = 0;
    const run = () => {
      if (document.visibilityState !== 'visible' || running || Date.now() - lastStarted < 1000) return;
      running = true;
      lastStarted = Date.now();
      void current.current().catch(() => { /* The page owns its error display. */ }).finally(() => { running = false; });
    };
    const interval = window.setInterval(run, intervalMs);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    const customEvents = eventKey ? eventKey.split(',') : [];
    customEvents.forEach(event => window.addEventListener(event, run));
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
      customEvents.forEach(event => window.removeEventListener(event, run));
    };
  }, [eventKey, intervalMs]);
}
