export type UnlistenFn = () => void;

export interface AsyncUnlistenBag {
  add: (promise: Promise<UnlistenFn>) => void;
  dispose: () => void;
}

export function createAsyncUnlistenBag(): AsyncUnlistenBag {
  let disposed = false;
  const unlisteners = new Set<UnlistenFn>();

  return {
    add(promise) {
      void promise.then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlisteners.add(unlisten);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
      unlisteners.clear();
    },
  };
}
