'use client';

import React from 'react';
import { X, Pause, Play, Trash2, Clock, User, Package } from 'lucide-react';
import { HeldSale, StoreSettings } from '@/types/pos';
import { playSound } from '@/utils/sound';

interface HeldSalesModalProps {
  isOpen: boolean;
  onClose: () => void;
  heldSales: HeldSale[];
  onResumeSale: (heldSale: HeldSale) => void;
  onDiscardHeldSale: (id: string) => void;
  settings: StoreSettings;
}

export const HeldSalesModal: React.FC<HeldSalesModalProps> = ({
  isOpen,
  onClose,
  heldSales,
  onResumeSale,
  onDiscardHeldSale,
  settings,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pause className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-sm text-white">Parked / Held Sales ({heldSales.length})</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List */}
        <div className="p-4 overflow-y-auto space-y-3">
          {heldSales.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Pause className="w-10 h-10 mx-auto mb-2 text-slate-600 stroke-[1.5]" />
              <p className="text-sm font-semibold text-slate-300">No Parked Sales</p>
              <p className="text-xs text-slate-500 mt-1">
                You can hold any ongoing sale by clicking &ldquo;Hold (F4)&rdquo; on the register screen.
              </p>
            </div>
          ) : (
            heldSales.map((held) => {
              const totalItems = held.items.reduce((acc, i) => acc + i.quantity, 0);
              const totalAmount = held.items.reduce((acc, i) => {
                const price = i.customPrice ?? i.product.price;
                return acc + price * i.quantity - (i.discount || 0);
              }, 0);

              return (
                <div
                  key={held.id}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 hover:border-slate-700 transition-all shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                          {held.invoiceNumber}
                        </span>
                        <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span>{held.dateStr}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-300 mt-1">
                        <User className="w-3 h-3 text-slate-500" />
                        <span>{held.customer?.name || 'Walk-in Customer'}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-black font-mono text-white">
                        {settings.currencySymbol} {totalAmount.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-slate-400 font-medium">
                        {totalItems} item{totalItems !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>

                  {/* Items Preview */}
                  <div className="text-[11px] text-slate-400 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800/60 truncate mb-3">
                    {held.items
                      .map((i) => `${i.quantity}x ${i.product.name}`)
                      .join(', ')}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      onClick={() => {
                        onDiscardHeldSale(held.id);
                        playSound('click', settings.soundEnabled);
                      }}
                      className="px-3 py-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Discard</span>
                    </button>
                    <button
                      onClick={() => {
                        onResumeSale(held);
                        playSound('beep', settings.soundEnabled);
                      }}
                      className="px-4 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-1.5 shadow-md transition-all active:scale-[0.98]"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Resume Sale</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
