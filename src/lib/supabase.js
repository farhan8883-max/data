// src/lib/supabase.js — satu client Supabase untuk seluruh aplikasi
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

const FALLBACK_URL = 'https://vpcagdtgmwkofvjexkps.supabase.co';
const FALLBACK_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwY2FnZHRnbXdrb2Z2amV4a3BzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxMTUwMTcsImV4cCI6MjA3NTY5MTAxN30.nu_xkb5cOHg9dVrPj-XdMlV77MRa2YnlZpqLgWT2cDU';

const url = (env.PUBLIC_SUPABASE_URL || FALLBACK_URL).trim();
const key = (env.PUBLIC_SUPABASE_ANON_KEY || FALLBACK_KEY).trim();

export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;