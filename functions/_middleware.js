const USERNAME = "test";

function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Market Insight", charset="UTF-8"',
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequest(context) {
  const password = context.env.APP_PASSWORD;
  // Keep the current site available until the secret is configured in Cloudflare.
  if (!password) return context.next();

  const authorization = context.request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Basic ")) return unauthorized();

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    const username = decoded.slice(0, separator);
    const suppliedPassword = decoded.slice(separator + 1);

    if (separator > -1 && username === USERNAME && suppliedPassword === password) {
      const response = await context.next();
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
  } catch {}

  return unauthorized();
}
