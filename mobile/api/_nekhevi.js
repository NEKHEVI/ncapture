// Session NEKHEVI côté serveur (Supabase Auth du même projet que app.nekhevi.com).
// Les jetons vivent dans des témoins HttpOnly (Secure, SameSite=Lax, chemin /api) : le JavaScript
// de la page ne les voit jamais. Chaque requête crée un client Supabase porteur du jeton de
// l'usager : la base applique la RLS (isolation par organisation), le serveur n'a aucune clé de service.
// Variables (par leur nom seulement) : NEKHEVI_SUPABASE_URL, NEKHEVI_SUPABASE_ANON_KEY
// (repli : SUPABASE_URL / SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_*), NCAPTURE_APP_URL,
// NCAPTURE_SELECTEUR_ORG (1 = sélecteur d'entreprise), NCAPTURE_CODE_REPLI (1 = ancien code d'accès permis).
// NCapture (NEKHEVI), AGPL-3.0.
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

export const AT = 'nc_at';
export const RT = 'nc_rt';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const estUuid = (x) => typeof x === 'string' && UUID.test(x);

export function supabaseEnv() {
  const e = process.env;
  const url = e.NEKHEVI_SUPABASE_URL || e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = e.NEKHEVI_SUPABASE_ANON_KEY || e.SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return url && anon ? { url: url.trim(), anon: anon.trim() } : null;
}

export const appUrl = () => (process.env.NCAPTURE_APP_URL || 'https://app.nekhevi.com').replace(/\/+$/, '');
export const selecteurActif = () => process.env.NCAPTURE_SELECTEUR_ORG === '1';
export const repliActif = () => process.env.NCAPTURE_CODE_REPLI === '1' && Boolean(process.env.CAPTURE_CODE);

/** Ancien code d'accès : seulement si NCAPTURE_CODE_REPLI=1 (désactivé par défaut). */
export function codeRepliValide(req) {
  if (!repliActif()) return false;
  const recu = req.headers['x-capture-code'];
  if (typeof recu !== 'string' || !recu) return false;
  const a = Buffer.from(recu), b = Buffer.from(process.env.CAPTURE_CODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function lireTemoins(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function temoin(nom, valeur, maxAge) {
  return `${nom}=${encodeURIComponent(valeur)}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function poserSession(res, s) {
  res.setHeader('Set-Cookie', [temoin(AT, s.access_token, 60 * 60 * 24), temoin(RT, s.refresh_token, 60 * 60 * 24 * 14)]);
}
export function effacerSession(res) {
  res.setHeader('Set-Cookie', [temoin(AT, '', 0), temoin(RT, '', 0)]);
}

export function clientAnonyme() {
  const env = supabaseEnv();
  if (!env) return null;
  return createClient(env.url, env.anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export function clientUsager(accessToken) {
  const env = supabaseEnv();
  return createClient(env.url, env.anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function claims(jwt) {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; }
}

/** Protection CSRF : toute écriture porte l'en-tête x-ncapture (un autre site ne peut pas l'ajouter sans CORS). */
export function ecritureSure(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (req.headers['x-ncapture'] !== '1') return false;
  const o = req.headers.origin;
  if (o && req.headers.host && new URL(o).host !== req.headers.host) return false;
  return true;
}

/**
 * Session de l'usager : { sb, user, mfaRequise } ou null. Renouvelle les jetons au besoin
 * (et repose les témoins). mfaRequise : l'usager a la double authentification, la session n'est pas aal2.
 */
export async function session(req, res) {
  if (!supabaseEnv()) return null;
  const t = lireTemoins(req);
  let at = t[AT], rt = t[RT];
  if (!at && !rt) return null;
  const anon = clientAnonyme();
  let user = null;
  if (at) {
    const { data } = await anon.auth.getUser(at);
    user = data?.user || null;
  }
  if (!user && rt) {
    const { data, error } = await anon.auth.refreshSession({ refresh_token: rt });
    if (error || !data?.session) { effacerSession(res); return null; }
    at = data.session.access_token; rt = data.session.refresh_token; user = data.session.user || data.user;
    poserSession(res, data.session);
  }
  if (!user) return null;
  const aMfa = (user.factors || []).some((f) => f.status === 'verified');
  const mfaRequise = aMfa && claims(at).aal !== 'aal2';
  return { sb: clientUsager(at), user, mfaRequise, at, rt };
}

/** Organisations de l'usager (lues par la RLS), triées par nom. */
export async function organisations(sb, userId) {
  const { data, error } = await sb.from('members')
    .select('role, organizations!inner(id, slug, name, brand_accent)')
    .eq('user_id', userId);
  if (error) throw new Error('orgs ' + error.message);
  return (data || []).map((m) => ({
    id: m.organizations.id, slug: m.organizations.slug, nom: m.organizations.name,
    couleur: m.organizations.brand_accent || null, role: m.role,
  })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr-CA'));
}

/**
 * Garde commune des routes à données : session valide, double authentification faite,
 * org demandée (en-tête x-ncapture-org) dont l'usager est membre. Répond elle-même 401/403/404
 * et renvoie null en cas de refus.
 */
export async function exigerOrg(req, res, { roles } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!supabaseEnv()) { res.status(503).json({ error: 'config' }); return null; }
  if (!ecritureSure(req)) { res.status(403).json({ error: 'csrf' }); return null; }
  const s = await session(req, res);
  if (!s) { res.status(401).json({ error: 'session' }); return null; }
  if (s.mfaRequise) { res.status(401).json({ error: 'mfa' }); return null; }
  const orgId = req.headers['x-ncapture-org'];
  if (!estUuid(orgId)) { res.status(400).json({ error: 'org' }); return null; }
  const { data, error } = await s.sb.from('members').select('role').eq('org_id', orgId).eq('user_id', s.user.id).maybeSingle();
  if (error || !data) { res.status(404).json({ error: 'org' }); return null; }
  if (roles && !roles.includes(data.role)) { res.status(403).json({ error: 'role' }); return null; }
  return { ...s, orgId, role: data.role };
}

export function corps(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return null; } }
  return b && typeof b === 'object' ? b : null;
}
