// ECOM-44 | upload-products-csv Edge Function
// Importa produtos em massa via arquivo CSV
// Formato esperado: nome,sku,preco,estoque,marketplace,categoria

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient, getUserClient } from "../_shared/supabase.ts";

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;
  const corsH = getCorsHeaders(req);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401, corsH);

  const userClient = getUserClient(authHeader);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sessão inválida" }, 401, corsH);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400, corsH); }

  const { organization_id, rows } = body;
  if (!organization_id || !Array.isArray(rows) || !rows.length) {
    return json({ error: "organization_id e rows[] são obrigatórios" }, 400, corsH);
  }

  const supabase = getServiceClient();
  const inserted: string[] = [];
  const errors: { row: number; error: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const name = String(row.nome || row.name || '').trim();
      const sku = String(row.sku || '').trim() || null;
      const price = parseFloat(row.preco ?? row.price ?? '0') || 0;
      const stock = parseInt(row.estoque ?? row.stock ?? '0', 10) || 0;

      if (!name) throw new Error("Nome obrigatório");

      const { data: product, error: pErr } = await supabase
        .from("products")
        .upsert({
          organization_id,
          name,
          sku: sku || `CSV-${Date.now()}-${i}`,
          status: "active",
        }, { onConflict: "organization_id,sku", ignoreDuplicates: false })
        .select("id")
        .single();

      if (pErr || !product) throw new Error(pErr?.message ?? "Erro ao inserir produto");

      // Estoque inicial
      if (stock > 0) {
        await supabase.from("channel_stock").upsert({
          product_id: product.id,
          organization_id,
          channel: row.marketplace || "proprio",
          quantity: stock,
          price,
        }, { onConflict: "product_id,channel", ignoreDuplicates: false });
      }

      inserted.push(name);
    } catch (err) {
      errors.push({ row: i + 1, error: String(err) });
    }
  }

  return json({
    total: rows.length,
    inserted: inserted.length,
    errors_count: errors.length,
    errors: errors.slice(0, 20), // máximo 20 erros retornados
    inserted_names: inserted.slice(0, 10),
  }, 200, corsH);
});

function json(d: unknown, s: number, h: Record<string, string>) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...h, "Content-Type": "application/json" } });
}
