import { useCallback, useEffect, useRef } from "react";
import { platform } from "../platform";

const AUTOSAVE_MS = 2000;

/** Serialize recovery operations so an older write cannot undo a later clear. */
export function useRecovery(
  json: string,
  dirty: boolean,
  path: string | null,
  enabled: boolean,
  onError: (message: string) => void,
) {
  const latest = useRef({ json, dirty, path });
  latest.current = { json, dirty, path };
  const queue = useRef(Promise.resolve());
  const generation = useRef(0);
  const enqueue = useCallback(
    (operation: () => Promise<void>) => {
      queue.current = queue.current
        .then(operation)
        .catch(() =>
          onError("Recovery could not be updated; save your project."),
        );
      return queue.current;
    },
    [onError],
  );
  const writeLatest = useCallback(() => {
    const state = latest.current;
    return state.dirty
      ? platform.recoveryWrite(state.json, state.path, new Date().toISOString())
      : platform.recoveryClear();
  }, []);
  const clearRecovery = useCallback(() => {
    generation.current++;
    return enqueue(() => platform.recoveryClear());
  }, [enqueue]);
  const savedRecovery = useCallback(
    (saved: string) =>
      enqueue(() => {
        const state = latest.current;
        return state.json === saved ? platform.recoveryClear() : writeLatest();
      }),
    [enqueue, writeLatest],
  );

  useEffect(() => {
    if (!enabled) return;
    const version = generation.current;
    const timer = setTimeout(
      () => {
        if (generation.current === version) void enqueue(writeLatest);
      },
      dirty ? AUTOSAVE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [json, dirty, path, enabled, enqueue, writeLatest]);

  return { clearRecovery, savedRecovery };
}
