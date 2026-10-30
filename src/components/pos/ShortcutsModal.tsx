'use client';

import React from 'react';
import { X, Keyboard, Zap } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'F1', description: 'Open POS Register Screen' },
    { key: 'F2', description: 'Quick Search / Focus Barcode Scanner' },
    { key: 'F3', description: 'Open Inventory & Stock Management' },
    { key: 'F4', description: 'Park / Hold Current Sale' },
    { key: 'F6', description: 'Open Customers & Khata Ledger' },
    { key: 'F7', description: 'Open Sales History & Day Book' },
    { key: 'F8', description: 'Clear Current Cart' },
    { key: 'F9 / Enter', description: 'Open Payment & Checkout (when in Cart)' },
    { key: 'F10', description: 'Open Store Settings' },
    { key: 'Esc', description: 'Close any open modal or dialog' },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-sm text-white">Keyboard Shortcuts</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2.5 max-h-[70vh] overflow-y-auto text-xs">
          {shortcuts.map((sc) => (
            <div
              key={sc.key}
              className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800"
            >
              <span className="text-slate-300 font-medium">{sc.description}</span>
              <kbd className="px-2 py-1 rounded bg-slate-800 text-blue-400 border border-slate-700 font-mono font-bold shadow-sm">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="p-3 bg-slate-950 border-t border-slate-800 text-center">
          <button
            onClick={onClose}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold text-xs transition-colors"
          >
            Got it (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
