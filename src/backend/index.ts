import type { AppConfig } from '../types';
import type { Backend } from './types';

export async function createBackend(cfg: AppConfig): Promise<Backend> {
  if (cfg.firebase && !cfg.demo) {
    const { FirebaseBackend } = await import('./firebase');
    return new FirebaseBackend(cfg.firebase);
  }
  const { MockBackend } = await import('./mock');
  return new MockBackend();
}

export async function loadConfig(): Promise<AppConfig> {
  const forceDemo = /[?&]demo\b/.test(location.search) || /[?&]demo\b/.test(location.hash);
  let firebase: AppConfig['firebase'] = null;
  try {
    const res = await fetch('config.json', { cache: 'no-cache' });
    if (res.ok) {
      const j = await res.json();
      const f = j?.firebase;
      if (f && f.apiKey && f.databaseURL && !String(f.apiKey).startsWith('PASTE')) firebase = f;
    }
  } catch { /* no config -> demo mode */ }
  return { firebase, demo: forceDemo || !firebase };
}
