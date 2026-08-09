import { getUserForToken } from '../data/state.js';

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const user = getUserForToken(token);
  if (!user) return res.status(401).json({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Missing or invalid session. Please log in again.' });
  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ type: 'about:blank', title: 'Forbidden', status: 403, detail: `This action requires one of: ${roles.join(', ')}.` });
    }
    next();
  };
}

// The concrete implementation of engg.md FEATURE_0's enforceStoreScope() — a PIC's
// data access is restricted to the single store they're seeded to (DEMO_USERS in
// state.js). Every other role in this prototype is chain-wide, matching the PRD
// (buyer/director/compliance/pharmacist all operate across stores).
export function enforceStoreScope(user, storeId) {
  if (user.role !== 'pic') return true;
  if (!user.storeId) return false; // a PIC with no store on file is a data error, never fail open
  return storeId === user.storeId;
}

export function requireStoreScope(req, res, storeId) {
  if (enforceStoreScope(req.user, storeId)) return true;
  res.status(403).json({
    type: 'about:blank', title: 'Forbidden', status: 403,
    detail: `Your account is scoped to store ${req.user.storeId}. This request is for a different store.`,
  });
  return false;
}
