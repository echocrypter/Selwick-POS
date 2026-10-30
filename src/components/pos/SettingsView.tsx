

'use client';

import React, { useEffect, useState } from 'react';

import { CloudSyncSettings } from '@/components/pos/CloudSyncSettings';
import { usePosAccess } from '@/components/pos/PosAccessGate';

import {

  Settings,

  Store,

  Printer,

  DollarSign,

  RotateCcw,

  Save,

  CheckCircle2,

  FolderOpen,

  Archive,

  Upload,

  ShieldCheck,

  RefreshCw,

  Clock3,

  Sun,

  Moon,

  Database,

} from 'lucide-react';

import { LocalStorageMigrationModal } from '@/components/pos/LocalStorageMigrationModal';
import { MigrationWizardModal } from '@/components/pos/MigrationWizardModal';
import { LicenseActivationModal } from '@/components/pos/LicenseActivationModal';
import { isTestSqliteModeActive, setTestSqliteMode } from '@/lib/data/dataAccessLayer';

import { StoreSettings } from '@/types/pos';

import { playSound } from '@/utils/sound';

import {

  chooseBackupFolder,

  createLocalBackup,

  getLastBackupInfo,

  getSavedFolderHandle,
  hasBackupFolderPermission,

  requestBackupFolderPermission,


  getBackupScheduleDescription,
  getBackupScheduleTime,
  setBackupScheduleTime,

  restorePosBackup,

  validateBackup,

} from '@/utils/localBackup';

interface SettingsViewProps {

  settings: StoreSettings;

  onUpdateSettings: (newSettings: StoreSettings) => void;

  onResetDemoData: () => void;

}

type BackupStatus = {

  message: string;

  kind: 'success' | 'error' | 'info';

};

export const SettingsView: React.FC<SettingsViewProps> = ({

  settings,

  onUpdateSettings,

  onResetDemoData,

}) => {

  const { mode } = usePosAccess();
  const [backupTime, setBackupTime] = useState('18:30');
  const [formData, setFormData] = useState<StoreSettings>(settings);

  const [folderAccessGranted, setFolderAccessGranted] = useState<boolean | null>(null);

  const [savedSuccess, setSavedSuccess] = useState(false);

  const [folderName, setFolderName] = useState<string | null>(null);

  const [backupStatus, setBackupStatus] = useState<BackupStatus>({

    message: 'Choose a local folder to enable automatic backups.',

    kind: 'info',

  });

  const [lastBackup, setLastBackup] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const [sqliteWizardOpen, setSqliteWizardOpen] = useState(false);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [testSqliteActive, setTestSqliteActive] = useState(false);

  useEffect(() => {
    setTestSqliteActive(isTestSqliteModeActive());
  }, []);

  useEffect(() => {

    setFormData(settings);

  }, [settings]);

  useEffect(() => {

    let cancelled = false;

    async function loadBackupInfo() {

      try {

        const handle = await getSavedFolderHandle();

        const permissionGranted = handle ? await hasBackupFolderPermission() : false;

        const last = getLastBackupInfo();
        const scheduleTime = getBackupScheduleTime();

        if (!cancelled) {

          setFolderName(handle?.name ?? null);

          setFolderAccessGranted(permissionGranted);

          setLastBackup(last.timestamp);
          setBackupTime(scheduleTime);

        }

      } catch {

        if (!cancelled) {

          setBackupStatus({

            message:

              'Could not read saved backup settings. Try choosing the folder again.',

            kind: 'error',

          });

        }

      }

    }

    void loadBackupInfo();

    return () => {

      cancelled = true;

    };

  }, []);

  const refreshBackupInfo = () => {

    setLastBackup(getLastBackupInfo().timestamp);

  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {

    event.preventDefault();

    onUpdateSettings({

      ...formData,

      theme: 'light',

    });

    setSavedSuccess(true);

    playSound('success', formData.soundEnabled);

    window.setTimeout(() => setSavedSuccess(false), 2500);

  };

  const handleBackupTimeChange = (time: string) => {
    try {
      setBackupScheduleTime(time);
      setBackupTime(time);
      setBackupStatus({ message: `Automatic backup time updated: ${getBackupScheduleDescription()}`, kind: 'success' });
    } catch (error) {
      setBackupStatus({ message: error instanceof Error ? error.message : 'Invalid backup time.', kind: 'error' });
    }
  };

  const handleChooseFolder = async () => {

    setBusy(true);

    try {

      const name = await chooseBackupFolder();

      setFolderName(name);
      setFolderAccessGranted(true);

      setBackupStatus({

        message: `Backup folder selected: ${name}. Keep this browser permission available.`,

        kind: 'success',

      });

    } catch (error) {

      setBackupStatus({

        message:

          error instanceof Error

            ? error.message

            : 'Could not select the backup folder.',

        kind: 'error',

      });

    } finally {

      setBusy(false);

    }

  };

  const handleGrantFolderAccess = async () => {
    setBusy(true);
    try {
      let granted = await requestBackupFolderPermission();
      if (!granted) {
        const name = await chooseBackupFolder();
        setFolderName(name);
        granted = true;
      }
      setFolderAccessGranted(granted);
      setBackupStatus({
        message: granted
          ? 'Folder access granted. Automatic backups can run when due.'
          : 'Folder access was not granted.',
        kind: granted ? 'success' : 'error',
      });
    } catch (error) {
      setBackupStatus({
        message: error instanceof Error ? error.message : 'Could not grant folder access.',
        kind: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleManualBackup = async () => {

    setBusy(true);

    try {

      const filename = await createLocalBackup('manual', true);

      refreshBackupInfo();

      setBackupStatus({

        message: `Backup created successfully: ${filename}`,

        kind: 'success',

      });

      playSound('success', settings.soundEnabled);

    } catch (error) {

      setBackupStatus({

        message:

          error instanceof Error

            ? error.message

            : 'Backup failed. Check folder permissions and available disk space.',

        kind: 'error',

      });

    } finally {

      setBusy(false);

    }

  };

  const handleRestore = async (

    event: React.ChangeEvent<HTMLInputElement>

  ) => {

    const file = event.target.files?.[0];

    event.target.value = '';

    if (!file) return;

    if (mode !== 'offline') {
      setBackupStatus({ message: 'Local backup restore is only available in offline mode.', kind: 'error' });
      return;
    }

    const confirmed = window.confirm(
      'Restore this backup? Current offline products, categories, customers, sales, settings and held sales will be replaced. A safety backup will be saved to your selected folder first.'
    );
    if (!confirmed) return;

    setBusy(true);

    try {

      const fileText = await file.text();

      const parsed: unknown = JSON.parse(fileText);

      const backup = validateBackup(parsed);

      // Do not modify live data unless a safety copy was successfully written to disk.
      const safetyFilename = await createLocalBackup('manual', true);

      restorePosBackup(backup);

      setBackupStatus({

        message:

          `Restore completed. Safety copy: ${safetyFilename}. Reloading the POS...`,

        kind: 'success',

      });

      window.setTimeout(() => window.location.reload(), 800);

    } catch (error) {

      setBackupStatus({

        message:

          error instanceof Error

            ? error.message

            : 'Restore failed. The selected file could not be restored.',

        kind: 'error',

      });

    } finally {

      setBusy(false);

    }

  };

  const handleRetryBackup = async () => {

    setBusy(true);

    try {

      const filename = await createLocalBackup('manual', true);

      refreshBackupInfo();

      setBackupStatus({

        message: `Backup created: ${filename}`,

        kind: 'success',

      });

    } catch (error) {

      setBackupStatus({

        message:

          error instanceof Error

            ? error.message

            : 'Backup failed.',

        kind: 'error',

      });

    } finally {

      setBusy(false);

    }

  };

  const formattedLastBackup = lastBackup

    ? new Date(lastBackup).toLocaleString(undefined, {

        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,

        dateStyle: 'medium',

        timeStyle: 'short',

      })

    : 'No successful backup recorded';

  const statusClass =

    backupStatus.kind === 'success'

      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'

      : backupStatus.kind === 'error'

        ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'

        : 'border-blue-500/30 bg-blue-500/10 text-blue-200';

  const inputClass =

    'w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  const sectionClass =

    'bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm';


  return (

    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">

      {/* Page heading */}

      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800">

        <div>

          <h2 className="text-lg font-bold text-white flex items-center gap-2">

            <Settings className="w-5 h-5 text-blue-400" />

            Selwick POS Settings

          </h2>

          <p className="text-xs text-slate-400">

            Configure your store, receipts, tax, appearance, and local backups.

          </p>

        </div>

        {savedSuccess && (

          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold">

            <CheckCircle2 className="w-4 h-4" />

            Settings Saved!

          </div>

        )}

      </div>

      {/* Main store settings form */}

      <form onSubmit={handleSubmit} className="space-y-6 text-xs" autoComplete="off">

        {/* Local Backup: offline records only */}

        {mode === 'offline' && (<section className={sectionClass}>

          <h3 className="font-bold text-sm text-white flex items-center gap-2 pb-2 border-b border-slate-800">

            <ShieldCheck className="w-4 h-4 text-emerald-400" />

            Local Backup & Restore

          </h3>

          <div className="rounded-xl border border-slate-700 bg-slate-950 p-4 space-y-3">

            <div className="flex items-start gap-3">

              <FolderOpen className="w-5 h-5 text-blue-400 mt-0.5" />

              <div className="min-w-0 flex-1">

                <p className="text-sm font-semibold text-white">

                  Backup folder

                </p>

                <p className="text-xs text-slate-400 mt-1 break-words">

                  {folderName

                    ? `Selected folder: ${folderName}`

                    : 'No folder selected yet.'}

                </p>

              </div>

            </div>

            <button

              type="button"

              disabled={busy}

              onClick={handleChooseFolder}

              className="px-4 py-2 text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl disabled:opacity-50"

            >

              <span className="inline-flex items-center gap-2">

                <FolderOpen className="w-4 h-4" />

                {folderName ? 'Change Backup Folder' : 'Choose Backup Folder'}

              </span>

            </button>

            {folderName && (
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 space-y-2">
                <p className="text-xs text-slate-300">
                  {folderAccessGranted
                    ? 'Folder access: granted. Automatic backups can run when due.'
                    : 'Folder access: needs permission for automatic backups.'}
                </p>
                {!folderAccessGranted && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleGrantFolderAccess}
                    className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl disabled:opacity-50"
                  >
                    Grant Folder Access
                  </button>
                )}
              </div>
            )}

          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">

              <div className="flex items-center gap-2 text-white font-semibold text-sm">

                <Clock3 className="w-4 h-4 text-blue-400" />

                Daily schedule

              </div>

              <p className="text-xs text-slate-400 mt-2">

                {getBackupScheduleDescription()}

              </p>

              <label htmlFor="pos-backup-time" className="block text-xs font-semibold text-slate-200 mt-3">
                Automatic backup time
              </label>
              <input
                id="pos-backup-time"
                type="time"
                value={backupTime}
                onChange={(event) => handleBackupTimeChange(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              />
              <p className="mt-2 text-xs text-slate-500">Uses this device's local time. Saved automatically.</p>

              <p className="text-xs text-amber-300 mt-2">

                The POS website must remain open for scheduled backups.

              </p>

            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">

              <div className="flex items-center gap-2 text-white font-semibold text-sm">

                <Archive className="w-4 h-4 text-emerald-400" />

                Last successful backup

              </div>

              <p className="text-xs text-slate-300 mt-2">

                {formattedLastBackup}

              </p>

            </div>

          </div>

          <div className="flex flex-wrap gap-3">

            <button

              type="button"

              disabled={busy || !folderName}

              onClick={handleManualBackup}

              className="px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl disabled:opacity-50"

            >

              <span className="inline-flex items-center gap-2">

                <Archive className="w-4 h-4" />

                {busy ? 'Please wait...' : 'Back Up Now'}

              </span>

            </button>

            <label

              className={`px-4 py-2.5 text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl cursor-pointer ${

                busy ? 'opacity-50 pointer-events-none' : ''

              }`}

            >

              <span className="inline-flex items-center gap-2">

                <Upload className="w-4 h-4" />

                Restore Backup File

              </span>

              <input

                type="file"

                accept=".json,application/json"

                className="hidden"

                disabled={busy}

                onChange={handleRestore}

              />

            </label>

            <button

              type="button"

              disabled={busy}

              onClick={handleRetryBackup}

              className="px-4 py-2.5 text-xs font-bold text-slate-200 border border-slate-700 rounded-xl hover:bg-slate-800 disabled:opacity-50"

            >

              <span className="inline-flex items-center gap-2">

                <RefreshCw className="w-4 h-4" />

                Retry / Check Access

              </span>

            </button>

            <button

              type="button"

              disabled={busy}

              onClick={() => setMigrationModalOpen(true)}

              className="px-4 py-2.5 text-xs font-bold text-emerald-300 border border-emerald-500/40 bg-emerald-500/10 rounded-xl hover:bg-emerald-500/20 disabled:opacity-50"

            >

              <span className="inline-flex items-center gap-2">

                <Database className="w-4 h-4 text-emerald-400" />

                Full LocalStorage Migration (Chrome ↔ Desktop)

              </span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setLicenseModalOpen(true)}
              className="px-4 py-2.5 text-xs font-bold text-emerald-300 border border-emerald-500/40 bg-emerald-500/10 rounded-xl hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Commercial License & Activation
              </span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setSqliteWizardOpen(true)}
              className="px-4 py-2.5 text-xs font-bold text-amber-300 border border-amber-500/40 bg-amber-500/10 rounded-xl hover:bg-amber-500/20 disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-400" />
                SQLite Migration Wizard (Stage A)
              </span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const next = !testSqliteActive;
                setTestSqliteMode(next);
                setTestSqliteActive(next);
                window.location.reload();
              }}
              className={`px-4 py-2.5 text-xs font-bold rounded-xl border transition ${
                testSqliteActive
                  ? 'border-rose-500/40 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                  : 'border-purple-500/40 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Database className={`w-4 h-4 ${testSqliteActive ? 'text-rose-400' : 'text-purple-400'}`} />
                {testSqliteActive ? 'Exit Isolated SQLite Test Mode' : 'Enter Isolated SQLite Test Mode'}
              </span>
            </button>
          </div>

          {testSqliteActive && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              <strong>Active: Isolated SQLite Test Mode</strong> — Using disposable test business database. LocalStorage business data is not read or modified.
            </div>
          )}

          <div

            className={`rounded-xl border p-3 text-xs leading-relaxed ${statusClass}`}

          >

            {backupStatus.message}

          </div>

          <p className="text-xs text-slate-500 leading-relaxed">

            Backups contain products, categories, customers, sales, store settings, and held

            sales from this browser profile. They do not include data stored

            elsewhere, browser session state, or an open shopping cart. Keep

            backup files secure because they contain business and customer data.

          </p>

        </section>)}

        {/* Client Business Profile */}

        <section className={sectionClass}>

          <h3 className="font-bold text-sm text-white flex items-center gap-2 pb-2 border-b border-slate-800">

            <Store className="w-4 h-4 text-blue-400" />

            Client Business Profile

          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div>

              <label className="text-slate-300 block mb-1 font-semibold">

                Business Name (shown on receipts)

              </label>

              <input

                required

                autoComplete="off"

                value={formData.storeName}

                onChange={(event) =>

                  setFormData({

                    ...formData,

                    storeName: event.target.value,

                  })

                }

                className={inputClass}

              />

            </div>

            <div>

              <label className="text-slate-300 block mb-1 font-semibold">

                Tagline / Subtitle

              </label>

              <input

                autoComplete="off"

                value={formData.tagline}

                onChange={(event) =>

                  setFormData({

                    ...formData,

                    tagline: event.target.value,

                  })

                }

                className={inputClass}

              />

            </div>

            <div>

              <label className="text-slate-300 block mb-1 font-semibold">

                Business Phone (shown on receipts)

              </label>

              <input

                autoComplete="off"

                value={formData.phone}

                onChange={(event) =>

                  setFormData({

                    ...formData,

                    phone: event.target.value,

                  })

                }

                className={inputClass}

              />

            </div>

            <div>

              <label className="text-slate-300 block mb-1 font-semibold">

                POS Terminal ID

              </label>

              <input

                autoComplete="off"

                value={formData.terminalId}

                onChange={(event) =>

                  setFormData({

                    ...formData,

                    terminalId: event.target.value,

                  })

                }

                className={inputClass}

              />

            </div>

          </div>

          <div>

            <label className="text-slate-300 block mb-1 font-semibold">

              Store Address

            </label>

            <input

              autoComplete="off"

              value={formData.address}

              onChange={(event) =>

                setFormData({

                  ...formData,

                  address: event.target.value,

                })

              }

              className={inputClass}

            />

          </div>

        </section>

        {/* Currency and Tax */}

        <section className={sectionClass}>

          <h3 className="font-bold text-sm text-white flex items-center gap-2 pb-2 border-b border-slate-800">

            <DollarSign className="w-4 h-4 text-emerald-400" />

            Currency & Sales Tax

          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            <div>

              <label className="text-slate-300 block mb-1 font-semibold">

                Currency Symbol

              </label>

              <input

                autoComplete="off"

                value={formData.currencySymbol}

                onChange={(event) =>

                  setFormData({

                    ...formData,

                    currencySymbol: event.target.value,

                  })

                }

                className={inputClass}

              />

            </div>

            <div>

              <label className="text-slate-300 block mb-1 font-semibold">

                Sales Tax Rate (%)

              </label>

              <input

                type="number"

                min="0"

                max="100"

                value={formData.taxRate}

                onChange={(event) =>

                  setFormData({

                    ...formData,

                    taxRate: Number.parseFloat(event.target.value) || 0,

                  })

                }

                className={inputClass}

              />

            </div>

            <label className="flex items-center gap-2.5 cursor-pointer pt-4">

              <input

                type="checkbox"

                checked={formData.enableTax}

                onChange={(event) =>

                  setFormData({

                    ...formData,

                    enableTax: event.target.checked,

                  })

                }

                className="w-4 h-4"

              />

              <span className="text-slate-200 font-semibold">

                Enable Tax by Default

              </span>

            </label>

          </div>

        </section>

        {/* Printer, Sound, and Receipt */}

        <section className={sectionClass}>

          <h3 className="font-bold text-sm text-white flex items-center gap-2 pb-2 border-b border-slate-800">

            <Printer className="w-4 h-4 text-cyan-400" />

            Thermal Printer & Audio Feedback

          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div>

              <label className="text-slate-300 block mb-1 font-semibold">

                Printer Paper Width

              </label>

              <select

                value={formData.printerPaperWidth}

                onChange={(event) =>

                  setFormData({

                    ...formData,

                    printerPaperWidth: event.target.value as '58mm' | '80mm',

                  })

                }

                className={inputClass}

              >

                <option value="80mm">80mm Standard POS Thermal Paper</option>

                <option value="58mm">58mm Compact POS Thermal Paper</option>

              </select>

            </div>

            <label className="flex items-center gap-2.5 cursor-pointer pt-4">

              <input

                type="checkbox"

                checked={formData.soundEnabled}

                onChange={(event) =>

                  setFormData({

                    ...formData,

                    soundEnabled: event.target.checked,

                  })

                }

                className="w-4 h-4"

              />

              <span className="text-slate-200 font-semibold">

                Enable Audio Sound Effects

              </span>

            </label>

          </div>

          <div>

            <label className="text-slate-300 block mb-1 font-semibold">

              Receipt Header Note

            </label>

            <input

              autoComplete="off"

              value={formData.receiptHeader}

              onChange={(event) =>

                setFormData({

                  ...formData,

                  receiptHeader: event.target.value,

                })

              }

              className={inputClass}

            />

          </div>

          <div>

            <label className="text-slate-300 block mb-1 font-semibold">

              Receipt Footer & Return Policy

            </label>

            <textarea

              rows={3}

              autoComplete="off"

              value={formData.receiptFooter}

              onChange={(event) =>

                setFormData({

                  ...formData,

                  receiptFooter: event.target.value,

                })

              }

              className={inputClass}

            />

          </div>

        </section>

        {/* Main form actions */}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">

          <button

            type="button"

            onClick={() => {

              if (

                window.confirm(

                  'Reset all demo data (products, sales history, customers) to default?'

                )

              ) {

                onResetDemoData();

                playSound('hold', settings.soundEnabled);

              }

            }}

            className="px-4 py-2 text-xs font-semibold text-[#A82F4D] bg-[#FFF1F3] hover:bg-[#FFE4EA] border border-[#F5B6C5] rounded-xl transition-colors flex items-center gap-1.5"

          >

            <RotateCcw className="w-4 h-4" />

            Reset Demo Data

          </button>

          <button

            type="submit"

            className="px-6 py-2.5 bg-[#7357E8] hover:bg-[#6045D2] text-white font-bold text-xs rounded-xl shadow-lg shadow-[#7357E8]/20 flex items-center gap-2"

          >

            <Save className="w-4 h-4" />

            Save Settings

          </button>

        </div>

      </form>

      {/* Cloud configuration is outside the main store settings form. */}

      <CloudSyncSettings />

      <LocalStorageMigrationModal
        isOpen={migrationModalOpen}
        onClose={() => setMigrationModalOpen(false)}
      />

      <MigrationWizardModal
        isOpen={sqliteWizardOpen}
        onClose={() => setSqliteWizardOpen(false)}
        currentUserRole="owner"
      />

      <LicenseActivationModal
        isOpen={licenseModalOpen}
        onClose={() => setLicenseModalOpen(false)}
      />

    </div>

  );

};
