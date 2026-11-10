import { NextRequest, NextResponse } from 'next/server';

async function expectedToken(): Promise<string> {
  const email  = process.env.DASHBOARD_EMAIL    || '';
  const pass   = process.env.DASHBOARD_PASSWORD || '';
  const secret = process.env.DASHBOARD_SECRET   || 'dc-dashboard-secret';
  const data   = new TextEncoder().encode(`${email}:${pass}:${secret}`);
  const hash   = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(hash).toString('hex');
}

export async function middleware(req: NextRequest) {
  const token    = req.cookies.get('dc_auth')?.value ?? '';
  const expected = await expectedToken();

  if (token !== expected) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/overview', '/chats', '/leads', '/payments', '/enrollments', '/prompt', '/config', '/discounts', '/demo'],
};
