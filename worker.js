export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };

    // Handle OPTIONS (Preflight)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Handle Supabase Proxy
    if (url.pathname.startsWith('/supabase/')) {
      const targetHost = "amlypzgchsujfxzmizif.supabase.co";
      // Remove /supabase prefix
      const newPath = url.pathname.replace(/^\/supabase/, '');
      const newUrl = `https://${targetHost}${newPath}${url.search}`;

      const newHeaders = new Headers(request.headers);
      newHeaders.set("Host", targetHost);
      newHeaders.delete("Referer");
      newHeaders.delete("Origin");

      try {
        const response = await fetch(newUrl, {
          method: request.method,
          headers: newHeaders,
          body: request.body,
          redirect: "follow",
        });

        // Recreate response to modify headers
        const newResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: new Headers(response.headers),
        });

        // Add CORS headers
        Object.keys(corsHeaders).forEach(key => {
          newResponse.headers.set(key, corsHeaders[key]);
        });

        return newResponse;
      } catch (err) {
        return new Response(JSON.stringify({ error: "Proxy Error: " + err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Serve Static Assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
