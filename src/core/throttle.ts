/** Leading + trailing throttle. Calls `fn` at most once per `ms`, always delivering the latest args. */
export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const run = (args: A) => { last = Date.now(); pending = null; fn(...args); };
  const t = (...args: A) => {
    const now = Date.now();
    if (now - last >= ms && !timer) { run(args); return; }
    pending = args;
    if (!timer) {
      timer = setTimeout(() => { timer = null; if (pending) run(pending); }, Math.max(0, ms - (now - last)));
    }
  };
  t.flush = () => { if (timer) { clearTimeout(timer); timer = null; } if (pending) run(pending); };
  t.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } pending = null; };
  return t;
}
