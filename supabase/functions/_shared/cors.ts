const ALLOWED_ORIGINS = [
  Deno.env.get("FRONTEND_URL") ?? "http://localhost:3000",
  "https://e-conomia.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
];

function getAllowOrigin(req: Request): string {
  const origin = req.headers.get("origin") ?? "";
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  // Aceita qualquer subdomínio vercel.app em preview
  if (origin.endsWith(".vercel.app")) return origin;
  return ALLOWED_ORIGINS[0];
}

export function getCorsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": getAllowOrigin(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

// Mantém compatibilidade com importações existentes
export const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("FRONTEND_URL") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }
  return null;
}
