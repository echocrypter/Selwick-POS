'use client';

import { useState } from 'react';
import { BUSINESS_TEMPLATES } from '@/data/businessTemplates';
import { Building2, Check, X } from 'lucide-react';

interface Props {
  open: boolean;
  canClose: boolean;
  busy: boolean;
  currentCategories: string[];
  onClose: () => void;
  onApply: (businessType: string, categories: string[]) => Promise<void>;
}

export function BusinessSetupModal({ open, canClose, busy, currentCategories, onClose, onApply }: Props) {
  const [selected, setSelected] = useState('retail');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  if (!open) return null;
  const template = BUSINESS_TEMPLATES.find(item => item.id === selected) ?? BUSINESS_TEMPLATES[1];
  const additions = selected === 'custom' ? custom.split(',') : [...template.categories];
  const categories = [...currentCategories, ...additions];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#17191A]/75 p-4" role="dialog" aria-modal="true" aria-label="Choose business type">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-8 text-[#29223B]">
        <div className="flex items-start justify-between gap-4">
          <div><div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#EDE8FF]"><Building2 className="text-[#6045D2]" /></div><h2 className="text-2xl font-extrabold">Set up your business</h2><p className="mt-1 text-sm text-[#625B78]">Choose your industry to get relevant product categories. No demo products will be added.</p></div>
          {canClose && <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-[#F5F2FF]" aria-label="Close"><X size={20}/></button>}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {BUSINESS_TEMPLATES.map(item => <button key={item.id} type="button" onClick={() => setSelected(item.id)} aria-pressed={selected === item.id} className={`min-h-28 rounded-xl border-2 p-3 text-left transition ${selected === item.id ? 'border-[#7357E8] bg-[#F0ECFF]' : 'border-[#E5DEF7] bg-white hover:border-[#9B88ED]'}`}><span className="flex items-start justify-between gap-1 text-sm font-bold">{item.name}{selected === item.id && <Check size={16} className="shrink-0 text-[#7357E8]"/>}</span><span className="mt-2 block text-xs text-[#625B78]">{item.description}</span></button>)}
        </div>
        {selected === 'custom' && <label className="mt-5 block text-sm font-semibold">Custom categories (comma separated)<input autoComplete="off" value={custom} onChange={e => setCustom(e.target.value)} placeholder="e.g. Books, Stationery, Gifts" className="mt-2 w-full rounded-xl border border-[#C8BFF1] bg-white px-3 py-3 text-[#29223B] outline-[#7357E8]"/></label>}
        {currentCategories.some(name => name !== 'All Items') && <p className="mt-5 text-sm font-medium text-[#6045D2]">Existing categories will be kept. New categories will be added without duplicates.</p>}
        <p className="mt-4 text-xs text-[#625B78]">Existing products and sales will never be deleted. Pharmacy-specific expiry, batch and prescription features are not included.</p>
        {error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
        <button type="button" disabled={busy || (selected === 'custom' && !custom.trim() && !currentCategories.some(c => c !== 'All Items'))} onClick={async () => {setError(''); try {await onApply(selected, categories);} catch (err) {setError(err instanceof Error ? err.message : 'Could not save business categories.');}}} className="mt-5 w-full rounded-xl bg-[#7357E8] px-5 py-3 font-bold text-white hover:bg-[#6045D2] disabled:opacity-50">{busy ? 'Saving business setup…' : 'Apply Business Categories'}</button>
      </div>
    </div>
  );
}
