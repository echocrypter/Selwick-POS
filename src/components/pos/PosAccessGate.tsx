'use client';

import React, { createContext, useContext, type ReactNode } from 'react';

export type PosAccessMode = 'cloud' | 'offline';
interface PosAccessContextValue {
  mode: PosAccessMode;
  activeBusinessId: string | null;
  businessRole: 'owner' | 'manager' | 'cashier' | null;
}
const PosAccessContext = createContext<PosAccessContextValue | null>(null);
export function usePosAccess(): PosAccessContextValue {
  const context = useContext(PosAccessContext);
  if (!context) throw new Error('usePosAccess must be used inside PosAccessGate.');
  return context;
}
/** Offline-first: local username/PIN authentication is handled by OfflineLogin in page.tsx. */
export default function PosAccessGate({ children }: { children: ReactNode }) {
  return (
    <PosAccessContext.Provider value={{ mode: 'offline', activeBusinessId: null, businessRole: null }}>
      {children}
    </PosAccessContext.Provider>
  );
}
