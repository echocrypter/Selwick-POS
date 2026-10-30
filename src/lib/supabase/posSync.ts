
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Sale } from '@/types/pos';

export type PosRecordType =
  | 'product'
  | 'customer'
  | 'sale'
  | 'setting'
  | 'held_sale'
  | 'category'
  | 'refund'
  | 'khata_settlement';

export interface CloudPosRecord {
  record_type: PosRecordType;
  record_id: string;
  data: unknown;
  updated_at: string;
}

export interface PosRecordToSave {
  record_type: PosRecordType;
  record_id: string;
  data: unknown;
}

const ACTIVE_BUSINESS_KEY = 'selwick_active_business_id';

export function getActiveBusinessId(): string | null {
  if (typeof window === 'undefined') return null;

  return window.localStorage.getItem(ACTIVE_BUSINESS_KEY);
}

export function clearActiveBusinessId(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACTIVE_BUSINESS_KEY);
}

async function requireAuthenticatedClient() {
  const client = getSupabaseClient();

  if (!client) {
    throw new Error(
      'Supabase is not configured. Check Settings > Cloud Sync.',
    );
  }

  const businessId = getActiveBusinessId();

  if (!businessId) {
    throw new Error('Select a business before accessing cloud data.');
  }

  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error) throw error;

  if (!user) {
    throw new Error('Please sign in to access cloud data.');
  }

  return { client, businessId, user };
}

export async function loadCloudPosRecords(): Promise<CloudPosRecord[]> {
  const { client, businessId } = await requireAuthenticatedClient();

  const { data, error } = await client
    .from('pos_records')
    .select('record_type, record_id, data, updated_at')
    .eq('business_id', businessId)
    .order('updated_at', { ascending: true });

  if (error) throw error;

  return (data ?? []) as CloudPosRecord[];
}

export async function saveCloudPosRecord(
  record: PosRecordToSave,
): Promise<void> {
  if (!record.record_id.trim()) {
    throw new Error('A record ID is required.');
  }

  const validTypes: PosRecordType[] = [
    'product',
    'customer',
    'sale',
    'setting',
    'held_sale',
    'category',
    'refund',
    'khata_settlement',
  ];

  if (!validTypes.includes(record.record_type)) {
    throw new Error('Invalid POS record type.');
  }

  const { client, businessId, user } =
    await requireAuthenticatedClient();

  const { error } = await client.from('pos_records').upsert(
    {
      business_id: businessId,
      record_type: record.record_type,
      record_id: record.record_id,
      data: record.data,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'business_id,record_type,record_id',
    },
  );

  if (error) throw error;
}

export async function deleteCloudPosRecord(
  recordType: PosRecordType,
  recordId: string,
): Promise<void> {
  if (!recordId.trim()) {
    throw new Error('A record ID is required.');
  }

  const { client, businessId } = await requireAuthenticatedClient();

  const { error } = await client
    .from('pos_records')
    .delete()
    .eq('business_id', businessId)
    .eq('record_type', recordType)
    .eq('record_id', recordId);

  if (error) throw error;
}

type PosSyncListener = () => void;
const cloudPosChangeListeners = new Set<PosSyncListener>();

/**
 * Manually notifies all registered cloud POS sync listeners in the application.
 * This triggers immediate reload of cloud records in active components.
 */
export function triggerCloudPosSync(): void {
  for (const listener of cloudPosChangeListeners) {
    try {
      listener();
    } catch (error) {
      console.error('Error invoking cloud POS sync listener:', error);
    }
  }
}

/**
 * Subscribe to changes in this business's POS records.
 * The caller should reload cloud records when notified.
 */
export async function subscribeToCloudPosChanges(
  onChange: () => void,
): Promise<() => void> {
  const { client, businessId } = await requireAuthenticatedClient();

  cloudPosChangeListeners.add(onChange);

  const channel = client
    .channel(`selwick-pos-${businessId}-${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'pos_records',
        filter: `business_id=eq.${businessId}`,
      },
      () => {
        onChange();
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(
          'Selwick POS Realtime subscription status:',
          status,
        );
      }
    });

  return () => {
    cloudPosChangeListeners.delete(onChange);
    void client.removeChannel(channel);
  };
}

/**
 * Completes a cloud sale through the PostgreSQL transaction function.
 * The database function records the sale and deducts stock atomically.
 */
export async function completeCloudPosSale(
  sale: Sale,
): Promise<{
  success: true;
  sale_id: string;
  completed_at: string;
}> {
  if (!sale.id?.trim()) {
    throw new Error('A sale ID is required.');
  }

  if (!Array.isArray(sale.items) || sale.items.length === 0) {
    throw new Error('Cannot complete a sale without items.');
  }

  if (sale.status !== 'completed') {
    throw new Error(
      'Only completed sales can be submitted to checkout.',
    );
  }

  const { client, businessId } = await requireAuthenticatedClient();

  const { data, error } = await client.rpc('complete_pos_sale', {
    p_business_id: businessId,
    p_sale: sale,
  });

  if (error) {
    throw new Error(
      error.message || 'Supabase could not complete the sale.',
    );
  }

  if (
    !data ||
    typeof data !== 'object' ||
    (data as Record<string, unknown>).success !== true ||
    typeof (data as Record<string, unknown>).sale_id !== 'string' ||
    typeof (data as Record<string, unknown>).completed_at !== 'string'
  ) {
    throw new Error(
      'Supabase did not return confirmation that the sale was completed.',
    );
  }

  return data as {
    success: true;
    sale_id: string;
    completed_at: string;
  };
}
