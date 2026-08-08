export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Edge compatibility shim for stale cached index pages that still point to old main bundle hashes.
    if (url.pathname === "/static/js/main.520aeb0e.js" || url.pathname === "/static/js/main.cc9e7425.js") {
      const target = new URL(request.url);
      target.pathname = "/static/js/main.00aa1971.js";
      const response = await env.ASSETS.fetch(new Request(target.toString(), request));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
