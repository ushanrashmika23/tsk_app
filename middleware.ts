import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  
  // If no password is set in the environment, we can optionally bypass auth
  // But for security, we should require it. If it's missing, we deny access to everything except /login.
  
  const isLoginPage = request.nextUrl.pathname === '/login';

  // We hash the password to create a simple, secure verification token
  let expectedToken = "unconfigured";
  if (password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "app_salt_task_manager");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    expectedToken = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const authCookie = request.cookies.get('auth_token')?.value;
  const isAuthenticated = authCookie === expectedToken && password !== undefined;
  const isApiRequest = request.nextUrl.pathname.startsWith('/api');

  if (!isAuthenticated && !isLoginPage) {
    // API callers expect a status code, not an HTML login page. Returning the
    // redirect here would hand a fetch() a 200 full of markup.
    if (isApiRequest) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isAuthenticated && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     *
     * `/api` is deliberately NOT excluded: the AI endpoint reads and writes the
     * user's data, so it has to sit behind the same authentication as the pages.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
