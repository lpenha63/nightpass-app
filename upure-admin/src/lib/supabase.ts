import { createClient } from '@supabase/supabase-js'

// Mesmo projeto Supabase dos apps de produto.
// A anon key é pública por design — quem protege os dados é a RLS
// (tabelas saas_* só são legíveis por profiles.is_saas_admin).
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? 'https://irghwfzcbazujddfftsx.supabase.co'
const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyZ2h3ZnpjYmF6dWpkZGZmdHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NjI4OTAsImV4cCI6MjA4ODEzODg5MH0.CMrdK4-7rWbgYcqttWtGF1CIWjywL0KVxYCBx27emhw'

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON)
