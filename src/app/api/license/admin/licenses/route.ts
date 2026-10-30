/**
 * GET  /api/license/admin/licenses
 * POST /api/license/admin/licenses
 *
 * Admin API for managing commercial licenses.
 * Protected with server-side administrator authorization.
 * Supports Turso cloud database in production and local SQLite in dev/testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLicenseDatabase } from '@/lib/licensing/licenseDb';
import {
  createLicense,
  listLicenses,
  generateCustomerMessage,
  LicenseError,
  type CreateLicenseParams,
  type ListLicensesOptions,
} from '@/lib/licensing/licenseService';
import { requireAdminAuth } from '@/lib/licensing/adminAuth';
import { isTursoConfigured, getTursoClient } from '@/lib/licensing/tursoClient';
import { createLicenseTurso, listLicensesTurso } from '@/lib/licensing/tursoRepository';
import { isProductionEnvironment } from '@/lib/licensing/serverKey';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = requireAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('q') || undefined;
  const status = (searchParams.get('status') as any) || undefined;
  const plan = (searchParams.get('plan') as any) || undefined;
  const sortBy = (searchParams.get('sortBy') as any) || undefined;
  const sortOrder = (searchParams.get('sortOrder') as any) || undefined;

  const options: ListLicensesOptions = {
    search,
    status,
    plan,
    sortBy,
    sortOrder,
  };

  try {
    let licenses;
    if (isTursoConfigured() || isProductionEnvironment()) {
      const client = getTursoClient();
      licenses = await listLicensesTurso(client, options);
    } else {
      const db = getLicenseDatabase();
      licenses = listLicenses(db, options);
    }
    return NextResponse.json({ ok: true, licenses }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Database error.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = requireAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: CreateLicenseParams;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON request body.' }, { status: 400 });
  }

  try {
    let license;
    if (isTursoConfigured() || isProductionEnvironment()) {
      const client = getTursoClient();
      license = await createLicenseTurso(client, {
        ...body,
        actor: auth.actor,
      });
    } else {
      const db = getLicenseDatabase();
      license = createLicense(db, {
        ...body,
        actor: auth.actor,
      });
    }

    const customerMessage = generateCustomerMessage(license);

    return NextResponse.json(
      { ok: true, license, customerMessage },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (err instanceof LicenseError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error creating license.' },
      { status: 500 }
    );
  }
}
