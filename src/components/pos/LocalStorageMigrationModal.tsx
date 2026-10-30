'use client';

import React, { useState } from 'react';
import {
  X,
  Upload,
  Download,
  AlertTriangle,
  CheckCircle2,
  FileJson,
  ShieldAlert,
  Users,
  Store,
  RefreshCw,
  ArrowRight,
  Database,
} from 'lucide-react';
import {
  exportAllLocalStorage,
  downloadBackupJson,
  validateAndAnalyzeBackup,
  executeLocalStorageImport,
  type BackupSummary,
} from '@/utils/localStorageMigration';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function LocalStorageMigrationModal({ isOpen, onClose, onSuccess }: Props) {
  const [fileData, setFileData] = useState<Record<string, string> | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [verificationResult, setVerificationResult] = useState<{
    writtenCount: number;
    verifiedCount: number;
    mismatches: string[];
    safetyBackupName?: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleExportCurrent = () => {
    try {
      const payload = exportAllLocalStorage();
      const name = downloadBackupJson(payload, 'selwick-full-storage-export');
      alert(`Full LocalStorage exported successfully: ${name} (${payload.totalKeys} keys)`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setFileData(null);
    setSummary(null);
    setConfirmed(false);
    setVerificationResult(null);
    setFileName(file.name);

    try {
      const text = await file.text();
      const { data, summary: analysis } = validateAndAnalyzeBackup(text);
      setFileData(data);
      setSummary(analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid backup file.');
    }
  };

  const handleExecuteImport = () => {
    if (!fileData || !summary || !confirmed) return;
    setIsBusy(true);
    setError('');

    try {
      // Step 1: Pre-import safety backup
      let safetyBackupName = '';
      if (typeof window !== 'undefined' && localStorage.length > 0) {
        const safetyPayload = exportAllLocalStorage();
        safetyBackupName = downloadBackupJson(safetyPayload, 'selwick-safety-backup-before-import');
      }

      // Step 2: Write and verify
      const result = executeLocalStorageImport(fileData);
      setVerificationResult({ ...result, safetyBackupName });
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-3xl border border-[#EAE6F6] bg-white p-6 shadow-2xl sm:p-8 my-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#EAE6F6]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#F0ECFF] text-[#7357E8]">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#211D35]">
                Full LocalStorage Migration
              </h2>
              <p className="text-xs text-[#625B78]">
                Export or import all POS accounts, products, sales, and settings.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-[#756E89] hover:bg-[#F3F0FC] hover:text-[#211D35] transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Export action banner */}
        <div className="mt-4 rounded-2xl border border-[#EAE6F6] bg-[#F8F7FC] p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[#211D35]">
              Export Current Environment
            </p>
            <p className="text-xs text-[#625B78]">
              Download all {typeof window !== 'undefined' ? localStorage.length : 0} keys currently stored in this window.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportCurrent}
            className="inline-flex items-center gap-2 rounded-xl border border-[#7357E8] bg-white px-4 py-2 text-xs font-bold text-[#7357E8] hover:bg-[#F0ECFF] transition shadow-sm"
          >
            <Download className="h-4 w-4" />
            Export Storage JSON
          </button>
        </div>

        {/* Import file selector */}
        {!verificationResult && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-bold text-[#211D35] mb-1">
                Select Backup JSON to Import
              </label>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 rounded-xl bg-[#7357E8] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#6045D2] cursor-pointer transition shadow-md shadow-[#7357E8]/20">
                  <Upload className="h-4 w-4" />
                  Choose Backup File (.json)
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>
                {fileName && (
                  <span className="text-xs font-medium text-[#211D35] truncate max-w-xs">
                    {fileName}
                  </span>
                )}
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Preview of validated backup */}
            {summary && fileData && (
              <div className="rounded-2xl border border-[#EAE6F6] bg-white p-4 space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-[#EAE6F6] pb-3">
                  <span className="text-xs font-bold text-[#7357E8] uppercase tracking-wider">
                    Backup Contents Preview
                  </span>
                  <span className="rounded-full bg-[#F0ECFF] px-2.5 py-1 text-xs font-bold text-[#7357E8]">
                    {summary.totalKeys} Total Keys Found
                  </span>
                </div>

                {/* Accounts preview */}
                <div className="rounded-xl border border-[#EAE6F6] bg-[#F8F7FC] p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#211D35]">
                    <Users className="h-4 w-4 text-[#7357E8]" />
                    Offline User Accounts ({summary.accounts.count})
                  </div>
                  {summary.accounts.count > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {summary.accounts.usernames.map((name, idx) => (
                        <span
                          key={idx}
                          className="rounded-lg border border-[#DAD4EF] bg-white px-2 py-0.5 text-xs text-[#211D35]"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#756E89]">No user accounts found in backup.</p>
                  )}
                </div>

                {/* Businesses preview */}
                <div className="rounded-xl border border-[#EAE6F6] bg-[#F8F7FC] p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#211D35]">
                    <Store className="h-4 w-4 text-[#7357E8]" />
                    Business Data Found
                  </div>

                  {Object.keys(summary.businesses).length > 0 ? (
                    Object.entries(summary.businesses).map(([bId, bData]) => (
                      <div
                        key={bId}
                        className="rounded-lg border border-[#DAD4EF] bg-white p-2.5 text-xs space-y-1"
                      >
                        <p className="font-semibold text-[#211D35]">
                          Business ID: <code className="text-[#7357E8]">{bId}</code>
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[#625B78]">
                          <div>Products: <b className="text-[#211D35]">{bData.productsCount}</b></div>
                          <div>Customers: <b className="text-[#211D35]">{bData.customersCount}</b></div>
                          <div>Sales: <b className="text-[#211D35]">{bData.salesCount}</b></div>
                          <div>Expenses: <b className="text-[#211D35]">{bData.expensesCount}</b></div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-[#DAD4EF] bg-white p-2.5 text-xs space-y-1">
                      <p className="font-semibold text-[#211D35]">
                        Legacy Unscoped Business Data:
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-[#625B78]">
                        <div>Products: <b className="text-[#211D35]">{summary.unscopedData.productsCount}</b></div>
                        <div>Customers: <b className="text-[#211D35]">{summary.unscopedData.customersCount}</b></div>
                        <div>Sales: <b className="text-[#211D35]">{summary.unscopedData.salesCount}</b></div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Storage Diff Summary */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-2.5">
                    <span className="font-semibold text-blue-900">New Keys to Add:</span>
                    <span className="ml-2 font-bold text-blue-700">{summary.newKeys.length}</span>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-2.5">
                    <span className="font-semibold text-amber-900">Keys to Overwrite:</span>
                    <span className="ml-2 font-bold text-amber-700">{summary.conflictingKeys.length}</span>
                  </div>
                </div>

                {/* Safety pre-restore notice */}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                  <div>
                    <p className="font-bold">Automatic Safety Backup Guaranteed</p>
                    <p className="mt-0.5 text-emerald-700">
                      Before modifying storage, an automatic backup file of your current data will be saved to your Downloads folder.
                    </p>
                  </div>
                </div>

                {/* Confirmation checkbox */}
                <label className="flex items-start gap-2.5 text-xs cursor-pointer pt-2">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#7357E8] focus:ring-[#7357E8]"
                  />
                  <span className="font-semibold text-[#211D35]">
                    I confirm that I want to import these {summary.totalKeys} keys into this application's LocalStorage.
                  </span>
                </label>

                {/* Action button */}
                <button
                  type="button"
                  disabled={!confirmed || isBusy}
                  onClick={handleExecuteImport}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#7357E8] px-4 py-3 text-sm font-bold text-white hover:bg-[#6045D2] disabled:opacity-50 transition shadow-md shadow-[#7357E8]/20"
                >
                  {isBusy ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Importing & Verifying...
                    </>
                  ) : (
                    <>
                      Confirm & Restore Storage
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Verification Success Screen */}
        {verificationResult && (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 space-y-4">
            <div className="flex items-center gap-3 text-emerald-800">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold">Import & Verification Complete!</h3>
                <p className="text-xs text-emerald-700">
                  {verificationResult.verifiedCount} of {verificationResult.writtenCount} keys written and verified successfully.
                </p>
              </div>
            </div>

            {verificationResult.safetyBackupName && (
              <p className="text-xs text-emerald-800 bg-emerald-100/60 p-2.5 rounded-xl">
                Pre-restore safety backup saved: <b>{verificationResult.safetyBackupName}</b>
              </p>
            )}

            {verificationResult.mismatches.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                Warning: {verificationResult.mismatches.length} key(s) failed verification.
              </div>
            )}

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#7357E8] px-4 py-3 text-sm font-bold text-white hover:bg-[#6045D2] transition shadow-md shadow-[#7357E8]/20"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Application Now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
