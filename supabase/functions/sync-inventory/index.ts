import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { MercadoLivre } from "../_shared/marketplace-clients.ts";

// Sincroniza o catálogo de produtos e estoque dos marketplaces conectados.
// Pode ser chamada via POST com { organization_id?, marketplace? }
serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const corsH = getCorsHeaders(req);
  const supabase = getServiceClient();

  let orgId: string | null = null;
  let marketplaceFilter: string | null = null;

  if (req.method === "POST") {
    try {
      const body = await req.json();
      orgId = body.organization_id ?? null;
      marketplaceFilter = body.marketplace ?? null;
    } catch { /* ignore */ }
  }

  // Buscar integrações ativas
  let query = supabase
    .from("marketplace_integrations")
    .select("id, organization_id, marketplace, seller_id, access_token")
    .eq("status", "active")
    .in("marketplace", ["mercado_livre"]);

  if (orgId) query = query.eq("organization_id", orgId);
  if (marketplaceFilter) query = query.eq("marketplace", marketplaceFilter);

  const { data: integrations, error: intErr } = await query;
  if (intErr) {
    return new Response(JSON.stringify({ error: intErr.message }), {
      status: 500,
      headers: { ...corsH, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ marketplace: string; products_synced: number; error?: string }> = [];

  for (const integration of integrations ?? []) {
    try {
      if (integration.marketplace === "mercado_livre") {
        const count = await syncMLInventory(
          supabase,
          integration.organization_id,
          integration.seller_id,
          integration.access_token
        );
        results.push({ marketplace: "mercado_livre", products_synced: count });
      }
    } catch (err) {
      console.error(`sync-inventory error [${integration.marketplace}]:`, err);
      results.push({ marketplace: integration.marketplace, products_synced: 0, error: String(err) });
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { ...corsH, "Content-Type": "application/json" },
  });
});

// =============================================================================
// MERCADO LIVRE — importa anúncios ativos como produtos
// =============================================================================
async function syncMLInventory(
  supabase: ReturnType<typeof getServiceClient>,
  orgId: string,
  sellerId: string,
  accessToken: string
): Promise<number> {
  const ML_API = "https://api.mercadolibre.com";
  const BATCH = 20; // ML aceita até 20 IDs por chamada de /items
  let offset = 0;
  let totalSynced = 0;

  while (true) {
    // 1. Buscar IDs de anúncios ativos
    const searchRes = await fetch(
      `${ML_API}/users/${sellerId}/items/search?status=active&limit=100&offset=${offset}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!searchRes.ok) throw new Error(`ML items/search failed: ${searchRes.status}`);
    const searchData = await searchRes.json();

    const itemIds: string[] = searchData.results ?? [];
    if (itemIds.length === 0) break;

    // 2. Buscar detalhes em batch
    for (let i = 0; i < itemIds.length; i += BATCH) {
      const batch = itemIds.slice(i, i + BATCH);
      const itemsRes = await fetch(
        `${ML_API}/items?ids=${batch.join(",")}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!itemsRes.ok) continue;
      const itemsData: Array<{ code: number; body: MLItem }> = await itemsRes.json();

      for (const entry of itemsData) {
        if (entry.code !== 200) continue;
        const item = entry.body;
        await upsertProduct(supabase, orgId, item);
        totalSynced++;
      }
    }

    const paging = searchData.paging ?? {};
    if (offset + itemIds.length >= (paging.total ?? 0)) break;
    offset += 100;
  }

  // Atualizar last_sync_at na integração
  await supabase
    .from("marketplace_integrations")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("marketplace", "mercado_livre");

  return totalSynced;
}

async function upsertProduct(
  supabase: ReturnType<typeof getServiceClient>,
  orgId: string,
  item: MLItem
) {
  const sku = item.id; // ex: MLB123456789
  const channel = item.shipping?.logistic_type === "fulfillment" ? "ml_full" : "ml_flex";

  // Upsert no catálogo mestre
  const { data: product, error: prodErr } = await supabase
    .from("products")
    .upsert(
      {
        organization_id: orgId,
        sku,
        name: item.title,
        sale_price: item.price ?? 0,
        cost_price: 0, // usuário preenche manualmente
        image_url: item.thumbnail ?? null,
        category: item.category_id ?? null,
        is_active: item.status === "active",
      },
      { onConflict: "organization_id,sku", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  if (prodErr || !product) {
    console.error(`upsert product ${sku} failed:`, prodErr?.message);
    return;
  }

  // Upsert no channel_stock
  await supabase.from("channel_stock").upsert(
    {
      organization_id: orgId,
      product_id: product.id,
      channel,
      quantity: item.available_quantity ?? 0,
      reserved: 0,
      channel_sku: item.id,
      channel_url: item.permalink ?? null,
    },
    { onConflict: "product_id,channel", ignoreDuplicates: false }
  );
}

interface MLItem {
  id: string;
  title: string;
  price: number;
  available_quantity: number;
  status: string;
  thumbnail?: string;
  permalink?: string;
  category_id?: string;
  shipping?: { logistic_type?: string };
}
