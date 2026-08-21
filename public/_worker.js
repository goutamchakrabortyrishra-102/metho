export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "www.methoaayupay.com") {
      url.hostname = "methoaayupay.com";
      return Response.redirect(url.toString(), 301);
    }

    const isAssetPath = (pathname) => {
      if (!pathname) return false;
      if (pathname.startsWith("/static/") || pathname.startsWith("/assets/") || pathname.startsWith("/icons/")) return true;
      if (pathname === "/manifest.json" || pathname === "/service-worker.js" || pathname === "/favicon.ico") return true;
      return /\.[a-z0-9]+$/i.test(pathname);
    };

    // 1) Try exact asset/path first.
    const exact = await env.ASSETS.fetch(request).catch(() => null);
    if (exact && exact.status !== 404) {
      const contentType = String(exact.headers.get("content-type") || "").toLowerCase();
      const isHtmlFallback = isAssetPath(url.pathname) && contentType.includes("text/html");
      if (!isHtmlFallback) return exact;
    }

    // 2) For asset requests, also try build-prefixed locations.
    if (isAssetPath(url.pathname)) {
      const prefixedCandidates = [
        `/build${url.pathname}`,
        `/frontend/build${url.pathname}`,
      ];

      for (const candidatePath of prefixedCandidates) {
        const candidateUrl = new URL(request.url);
        candidateUrl.pathname = candidatePath;
        const candidateRequest = new Request(candidateUrl.toString(), request);
        const candidateResponse = await env.ASSETS.fetch(candidateRequest).catch(() => null);
        if (candidateResponse && candidateResponse.status !== 404) return candidateResponse;
      }

      // Never return index.html for JS/CSS/image requests.
      return new Response("Not Found", { status: 404 });
    }

    // 3) SPA fallback for route requests only.
    const indexRequest = new Request(new URL("/index.html", request.url).toString(), request);
    return env.ASSETS.fetch(indexRequest);
  },
};
