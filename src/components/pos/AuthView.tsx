
'use client';

import React, { useState } from 'react';
import {
  Store,
  Mail,
  LockKeyhole,
  UserRound,
  Eye,
  EyeOff,
  Cloud,
  AlertCircle,
  LoaderCircle,
  ArrowRight,
} from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';

interface AuthViewProps {
  onAuthenticated: () => void;
}

type AuthMode = 'login' | 'signup';

export default function AuthView({
  onAuthenticated,
}: AuthViewProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [storeName, setStoreName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'error' | 'info'>('info');

  const isSignup = mode === 'signup';

  const showMessage = (
    text: string,
    type: 'error' | 'info' = 'info',
  ) => {
    setMessage(text);
    setMessageType(type);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');

    const client = getSupabaseClient();

    if (!client) {
      showMessage(
        'Supabase is not configured correctly. Open Settings → Cloud Sync, save your project URL and publishable key, then try again.',
        'error',
      );
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (password.length < 6) {
      showMessage('Your password must contain at least 6 characters.', 'error');
      return;
    }

    if (isSignup && !storeName.trim()) {
      showMessage('Enter your business name to continue.', 'error');
      return;
    }

    setLoading(true);

    try {
      if (isSignup) {
        const { data, error } = await client.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              store_name: storeName.trim(),
            },
          },
        });

        if (error) {
          showMessage(error.message, 'error');
          return;
        }

        if (data.session) {
          showMessage('Your account was created successfully.', 'info');
          onAuthenticated();
          return;
        }

        showMessage(
          'Registration submitted. Check your email for a confirmation link if email confirmation is enabled in Supabase. After confirming, return here and log in.',
          'info',
        );
      } else {
        const { error } = await client.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error) {
          showMessage(error.message, 'error');
          return;
        }

        onAuthenticated();
      }
    } catch {
      showMessage(
        'Unable to complete authentication. Check your internet connection and Supabase project configuration.',
        'error',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-slate-950 px-4 py-10 text-white">
      <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-500/30 bg-blue-500/10">
            <Store className="h-7 w-7 text-blue-400" />
          </div>

          <h1 className="text-2xl font-bold tracking-tight">
            Selwick POS
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            {isSignup
              ? 'Create an account for your business'
              : 'Sign in to your business account'}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-950 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setMessage('');
            }}
            className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
              !isSignup
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Log in
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setMessage('');
            }}
            className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
              isSignup
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
          {isSignup && (
            <div>
              <label
                htmlFor="selwick-store-name"
                className="mb-1.5 block text-sm font-medium text-slate-300"
              >
                Business name
              </label>

              <div className="relative">
                <Store className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />

                <input
                  id="selwick-store-name"
                  type="text"
                  autoComplete="off"
                  maxLength={120}
                  required
                  value={storeName}
                  onChange={(event) => setStoreName(event.target.value)}
                  placeholder="My Store"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="selwick-email"
              className="mb-1.5 block text-sm font-medium text-slate-300"
            >
              Email address
            </label>

            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />

              <input
                id="selwick-email"
                type="email"
                autoComplete="off"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="selwick-password"
              className="mb-1.5 block text-sm font-medium text-slate-300"
            >
              Password
            </label>

            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />

              <input
                id="selwick-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="off"
                minLength={6}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 6 characters"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-10 pr-11 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />

              <button
                type="button"
                onClick={() => setShowPassword((previous) => !previous)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {message && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
                messageType === 'error'
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  : 'border-blue-500/30 bg-blue-500/10 text-blue-200'
              }`}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{message}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}

            {loading
              ? 'Please wait...'
              : isSignup
                ? 'Create business account'
                : 'Log in to Selwick POS'}
          </button>
        </form>

        <div className="mt-6 flex items-start gap-2 border-t border-slate-800 pt-5">
          <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <p className="text-xs leading-relaxed text-slate-500">
            Your account uses the Supabase project configured on this
            device. Authentication does not yet enable POS data
            synchronization.
          </p>
        </div>
      </section>
    </main>
  );
}
