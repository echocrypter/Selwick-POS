/**
 * GET /api/license/admin/overview
 *
 * Retrieves high-level operational metrics for the commercial license dashboard.
 * Supports Turso cloud database in production and local SQLite in dev/testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLicenseDatabase } from '@/lib/licensing/licenseDb';
import { getDashboardMetrics } from '@/lib/licensing/licenseService';
import { requireAdminAuth } from '@/lib/licensing/adminAuth';
import { isTursoConfigured, getTursoClient } from '@/lib/licensing/tursoClient';
import { getDashboardMetricsTurso } from '@/lib/licensing/tursoRepository';
import { isProductionEnvironment } from '@/lib/licensing/serverKey';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = requireAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    let metrics;
    if (isTursoConfigured() || isProductionEnvironment()) {
      const client = getTursoClient();
      metrics = await getDashboardMetricsTurso(client);
    } else {
      const db = getLicenseDatabase();
      metrics = getDashboardMetrics(db);
    }
    return NextResponse.json({ ok: true, metrics }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Database error.' },
      { status: 500 }
    );
  }
}
