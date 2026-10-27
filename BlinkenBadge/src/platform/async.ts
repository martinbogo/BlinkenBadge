export class OperationTimeout extends Error {}

export async function withTimeout<T>(
  operation: Promise<T>,
  ms: number,
  message: string,
  cancel: () => void = () => {},
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            cancel();
          } catch {
            /* The deadline must still reject if cleanup fails. */
          }
          reject(new OperationTimeout(message));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A second click or consumer cannot start an overlapping device operation. */
export function operationLock() {
  let busy = false;
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (busy) throw new Error("A device operation is already running.");
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  };
}
