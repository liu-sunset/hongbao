export async function onRequest(context) {
  const { request, params } = context;
  const url = new URL(request.url);
  
  // 你的 Supabase 原始域名
  const targetHost = "amlypzgchsujfxzmizif.supabase.co";
  
  // 重新构建目标 URL
  const path = params.path ? params.path.join('/') : '';
  const search = url.search;
  const newUrl = `https://${targetHost}/${path}${search}`;

  // 复制并修改请求头
  const newHeaders = new Headers(request.headers);
  newHeaders.set("Host", targetHost);
  
  // 移除 Referer 和 Origin 以避免 Supabase 的 CORS/安全策略拦截
  newHeaders.delete("Referer");
  newHeaders.delete("Origin");

  const newRequest = new Request(newUrl, {
    method: request.method,
    headers: newHeaders,
    body: request.body,
    redirect: "follow",
  });

  try {
    const response = await fetch(newRequest);
    
    // 复制响应并添加必要的 CORS 头，确保前端可以跨域读取
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "*");
    
    // 如果是 OPTIONS 请求，直接返回成功
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: responseHeaders,
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Proxy Error: " + err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
