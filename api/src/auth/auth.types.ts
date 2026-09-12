export const SESSION_COOKIE = 'ot_session';

export interface RequestUser {
  userId: string;
  tenantId: string;
  role: 'owner' | 'admin' | 'agent';
  email: string;
  locale: string;
  sessionId: string;
}

export interface RequestAdmin {
  adminId: string;
  email: string;
  locale: string;
  sessionId: string;
}

declare module 'express' {
  interface Request {
    user?: RequestUser;
    platformAdmin?: RequestAdmin;
  }
}
