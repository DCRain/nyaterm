import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface EncryptedNotesSessionValue {
  unlockedFolderIds: Set<string>;
  isFolderUnlocked: (folderId: string) => boolean;
  getFolderPassword: (folderId: string) => string | null;
  unlockFolder: (folderId: string, password: string) => void;
  lockFolder: (folderId: string) => void;
  clearAll: () => void;
}

const EncryptedNotesSessionContext = createContext<EncryptedNotesSessionValue | null>(null);

/** In-memory session unlock for encrypted note folders (cleared on app reload). */
export function EncryptedNotesSessionProvider({ children }: { children: ReactNode }) {
  const [unlockedFolderIds, setUnlockedFolderIds] = useState<Set<string>>(() => new Set());
  // Passwords stay in a ref so they never trigger re-renders or get logged via state dumps.
  const passwordsRef = useRef<Map<string, string>>(new Map());

  const isFolderUnlocked = useCallback(
    (folderId: string) => unlockedFolderIds.has(folderId),
    [unlockedFolderIds],
  );

  const getFolderPassword = useCallback((folderId: string) => {
    return passwordsRef.current.get(folderId) ?? null;
  }, []);

  const unlockFolder = useCallback((folderId: string, password: string) => {
    passwordsRef.current.set(folderId, password);
    setUnlockedFolderIds((prev) => {
      if (prev.has(folderId)) return prev;
      const next = new Set(prev);
      next.add(folderId);
      return next;
    });
  }, []);

  const lockFolder = useCallback((folderId: string) => {
    passwordsRef.current.delete(folderId);
    setUnlockedFolderIds((prev) => {
      if (!prev.has(folderId)) return prev;
      const next = new Set(prev);
      next.delete(folderId);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    passwordsRef.current.clear();
    setUnlockedFolderIds(new Set());
  }, []);

  const value = useMemo(
    () => ({
      unlockedFolderIds,
      isFolderUnlocked,
      getFolderPassword,
      unlockFolder,
      lockFolder,
      clearAll,
    }),
    [unlockedFolderIds, isFolderUnlocked, getFolderPassword, unlockFolder, lockFolder, clearAll],
  );

  return createElement(EncryptedNotesSessionContext.Provider, { value }, children);
}

export function useEncryptedNotesSession(): EncryptedNotesSessionValue {
  const context = useContext(EncryptedNotesSessionContext);
  if (!context) {
    throw new Error("useEncryptedNotesSession must be used within EncryptedNotesSessionProvider");
  }
  return context;
}
