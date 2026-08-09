export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Edge compatibility shim for stale cached index pages/chunks that still point to old hashed files.
    if (/^\/static\/js\/main\.[a-f0-9]+\.js$/i.test(url.pathname) && url.pathname !== "/static/js/main.be905c2b.js") {
      const target = new URL(request.url);
      target.pathname = "/static/js/main.be905c2b.js";
      const response = await env.ASSETS.fetch(new Request(target.toString(), request));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    if (/^\/static\/js\/9442\.[a-f0-9]+\.chunk\.js$/i.test(url.pathname) && url.pathname !== "/static/js/9442.249e165b.chunk.js") {
      const target = new URL(request.url);
      target.pathname = "/static/js/9442.249e165b.chunk.js";
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
