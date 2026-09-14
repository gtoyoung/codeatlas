export function isSameOriginRequest(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  try {
    const requestUrl = new URL(request.url);
    const host = request.headers.get('host') ?? requestUrl.host;
    const publicUrl = new URL(`${requestUrl.protocol}//${host}`);
    return new URL(origin).origin === publicUrl.origin;
  } catch {
    return false;
  }
}
