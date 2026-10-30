'use client';

import { useEffect } from 'react';
import { usePosAccess } from '@/components/pos/PosAccessGate';
import {
  createLocalBackup,
  getBackupDate,
  getBackupScheduleTime,
  getLastBackupInfo,
  isDailyBackupDue,
} from '@/utils/localBackup';

const CHECK_INTERVAL_MS = 30_000;
const RETRY_INTERVAL_MS = 5 * 60_000;

export function LocalBackupScheduler() {
  const { mode } = usePosAccess();

  useEffect(() => {
    // Cloud POS data is not held in the offline localStorage collections.
    // Never produce a misleading local backup while in cloud mode.
    if (mode !== 'offline') return;

    let stopped = false;
    let running = false;
    let lastAttemptAt = 0;

    const checkBackup = async () => {
      if (stopped || running || !isDailyBackupDue()) return;

      const today = getBackupDate();
      const lastBackup = getLastBackupInfo();

      // A backup already created today should not trigger duplicate runs, but only
      // when it happened at or after today's scheduled time. An earlier backup
      // (for example a manual backup or a previous schedule) must not suppress
      // the configured daily scheduled backup.
      if (lastBackup.date === today && lastBackup.timestamp) {
        const [hour, minute] = getBackupScheduleTime().split(':').map(Number);
        const scheduledToday = new Date();
        scheduledToday.setHours(hour, minute, 0, 0);
        const lastBackupTime = Date.parse(lastBackup.timestamp);
        if (!Number.isNaN(lastBackupTime) && lastBackupTime >= scheduledToday.getTime()) {
          return;
        }
      }

      // A failed attempt may retry while the POS remains open, but not every 30 seconds.
      const now = Date.now();
      if (lastAttemptAt && now - lastAttemptAt < RETRY_INTERVAL_MS) return;

      running = true;
      lastAttemptAt = now;

      try {
        // A scheduled backup must never show an unexpected folder-permission prompt.
        // The user can grant folder access from POS Settings.
        await createLocalBackup('scheduled', true);
      } catch (error) {
        if (!stopped) {
          console.warn('Automatic POS backup was not completed:', error);
        }
      } finally {
        running = false;
      }
    };

    // This also catches up when the customer opens the POS after the scheduled time.
    void checkBackup();
    const timer = window.setInterval(() => void checkBackup(), CHECK_INTERVAL_MS);

    // Recheck when returning to an open tab after the computer was asleep.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkBackup();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [mode]);

  return null;
}
