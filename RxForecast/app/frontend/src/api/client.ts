const BASE = '/api';

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem('rxf_token', token);
  else localStorage.removeItem('rxf_token');
}
export function loadStoredToken() {
  authToken = localStorage.getItem('rxf_token');
  return authToken;
}

export class ApiError extends Error {
  status: number;
  detail: string;
  body: unknown;
  constructor(status: number, detail: string, body: unknown) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const detail = (body && typeof body === 'object' && 'detail' in body) ? String((body as { detail: unknown }).detail) : res.statusText;
    // A localStorage-cached token can outlive the backend's in-memory session store
    // (e.g. after a dev-server restart, since sessions aren't persisted — see GAPS.md
    // "Authentication"). Without this, every subsequent request 401s forever and the
    // UI just spins on a loading state with no way out short of manually clearing
    // storage. Clear the stale session and reload so the app falls back to Landing/Login.
    if (res.status === 401) {
      setAuthToken(null);
      localStorage.removeItem('rxf_user');
      window.location.reload();
    }
    throw new ApiError(res.status, detail, body);
  }
  return body as T;
}

export const api = {
  login: (role: string) => request<{ token: string; user: { userId: string; name: string; role: string; storeId: string | null } }>('/auth/login', { method: 'POST', body: JSON.stringify({ role }) }),
  getQueue: (params: Record<string, string> = {}) => request<{ rows: QueueRow[]; total: number; generatedAt: string; scopedToStore: string | null }>(`/queue?${new URLSearchParams(params)}`),
  getQueueDetail: (key: string) => request<QueueDetail>(`/queue/${encodeURIComponent(key)}/detail`),
  deferQueueItem: (key: string) => request(`/queue/${encodeURIComponent(key)}/defer`, { method: 'POST' }),
  rejectQueueItem: (key: string, reason: string) => request(`/queue/${encodeURIComponent(key)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  getForecast: (storeId: string, ndc: string) => request<ForecastResponse>(`/forecast/${storeId}/${ndc}`),
  getShortages: (status?: string) => request<Shortage[]>(`/shortages${status ? `?status=${status}` : ''}`),
  getShortageFeedStatus: () => request<{ liveFeedActive: boolean; shortageCount: number }>('/shortages/feed-status'),
  getSubstitutions: (shortageId: string) => request<Substitution[]>(`/shortages/${shortageId}/substitutions`),
  decideSubstitution: (id: string, decision: 'accept' | 'reject', altNdc?: string) =>
    request<Substitution>(`/substitutions/${id}/decision`, { method: 'POST', body: JSON.stringify({ decision, altNdc }) }),
  createPo: (body: { storeId: string; ndc: string; distributorId: string; quantity?: number; confirmOverride?: boolean }) =>
    request<Po>('/pos', { method: 'POST', body: JSON.stringify(body) }),
  bulkApprovePos: (items: { key: string; storeId: string; ndc: string; distributorId: string; quantity?: number; confirmOverride?: boolean }[]) =>
    request<BulkApproveResult>('/pos/bulk', { method: 'POST', body: JSON.stringify({ items }) }),
  rejectPo: (id: string, reason: string) => request<Po>(`/pos/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  getPo: (id: string) => request<Po>(`/pos/${id}`),
  listPos: (params: Record<string, string> = {}) => request<Po[]>(`/pos?${new URLSearchParams(params)}`),
  getOverrides: () => request<Override[]>('/overrides'),
  createOverride: (body: Partial<Override>) => request<{ override: Override; conflictWarning: string | null }>('/overrides', { method: 'POST', body: JSON.stringify(body) }),
  toggleOverride: (id: string, active: boolean) => request<Override>(`/overrides/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  getAudit: (params: Record<string, string> = {}) => request<AuditEntry[]>(`/audit?${new URLSearchParams(params)}`),
  getDashboard: () => request<DashboardSummary>('/dashboard/summary'),
  getStores: () => request<Store[]>('/dashboard/stores'),
  getFormulary: () => request<Drug[]>('/formulary'),
};

// --- Types (mirroring the backend shapes) ---
export interface Store { storeId: string; name: string; city: string; state: string; }
export interface Drug {
  ndc: string; genericName: string; brandName: string; category: string; dosageForm: string; strength: string;
  packSize: number; deaSchedule: number; teCode: string; velocityTier: string; isControlled: boolean; is340b: boolean;
  wacPrice: number; unitCost: number; manufacturer: string;
}
export interface QueueRow {
  key: string; storeId: string; ndc: string; genericName: string; brandName: string; category: string;
  velocityTier: string; isControlled: boolean; deaSchedule: number; forecastQty7d: number | null; insufficientData: boolean;
  recommendedQty: number;
  onHand: number | null; daysOfSupply: number | null; priorityScore: number; urgencyBand: 'high' | 'medium' | 'low' | 'insufficient_data';
  shortageLinked: boolean;
}
export interface BulkApproveResult {
  approved: number; failed: number;
  results: { key: string; ok: boolean; po?: Po; status?: number; detail?: string; agentRecommended?: number }[];
}
export interface QueueDetail extends QueueRow {
  drug: Drug; contracts: { id: string; ndc: string; distributorId: string; type: string; price: number; gpoName: string }[]; store: Store;
}
export interface ForecastResponse {
  storeId: string; ndc: string; drug: Drug;
  forecast: { forecastQty7d: number | null; confidenceLow: number | null; confidenceHigh: number | null; avgDaily: number; insufficientData: boolean; dataWindowDays: number; series: { date: string; qty: number }[] };
  inventory: { onHand: number; inTransit: number; reorderPointDays: number; targetDays: number } | null;
  citations: { type: string; detail: string; source: string }[];
}
export interface Shortage {
  id: string; ndc: string; genericName: string; source: string; status: string; dateReported: string;
  dateResolved: string; reason: string; severity: string; bulletinId: string; bulletinExcerpt: string | null; demoStatusOverride?: boolean;
}
export interface Substitution {
  id: string; shortageId: string; storeId: string; originalNdc: string; originalGenericName: string; severity: string; reason: string;
  options: { altNdc: string; altGenericName: string; altBrandName: string; teMatch: boolean; rationale: string; blocked: boolean }[];
  decision: 'pending' | 'accepted' | 'rejected'; confidence: number;
}
export interface Po {
  id: string; storeId: string; distributorId: string; status: string;
  lines: { ndc: string; quantityAgent: number; quantityFinal: number; unitPrice: number }[];
  createdAt: string; approvedBy: string; transmittedAt: string | null; ediRaw850: string | null; ediRaw855: string | null; ackStatus: string | null;
}
export interface Override { id: string; buyerId: string; storeId: string | null; ndc: string; genericName: string; type: string; rationale: string; createdDate: string; active: boolean; }
export interface AuditEntry { id: string; entityType: string; entityId: string; action: string; actorUserId: string; actorRole: string; payload: Record<string, unknown>; sources: string[]; createdAt: string; }
export interface DashboardSummary {
  asOf: string; isSnapshotOnly: boolean;
  stockoutRisk: { totalTracked: number; highUrgency: number; mediumUrgency: number; highUrgencyPct: number };
  orders: { total: number; byStatus: Record<string, number> };
  shortages: { active: number; substitutionsPending: number; substitutionsAccepted: number; acceptRate: number | null };
  illustrativeSavingsUsd: number; auditEntries: number;
}
