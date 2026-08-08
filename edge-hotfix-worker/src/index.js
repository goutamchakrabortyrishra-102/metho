const CURRENT_MAIN = "https://methoaayupay.com/static/js/main.00aa1971.js";

export default {
  async fetch(request) {
    const upstream = await fetch(CURRENT_MAIN, {
      cf: {
        cacheEverything: false,
        cacheTtl: 0,
      },
    });

    const headers = new Headers(upstream.headers);
    headers.set("cache-control", "no-store, no-cache, must-revalidate");
    headers.set("pragma", "no-cache");
    headers.set("expires", "0");
    headers.set("content-type", "application/javascript; charset=utf-8");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
