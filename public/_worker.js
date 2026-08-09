export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Try to serve the exact static asset first
    const assetResponse = await env.ASSETS.fetch(request).catch(() => null);
    if (assetResponse && assetResponse.status !== 404) return assetResponse;
    // SPA fallback: any unmatched path serves index.html so React Router handles it
    const indexRequest = new Request(new URL("/index.html", request.url).toString(), request);
    return env.ASSETS.fetch(indexRequest);
  },
};
