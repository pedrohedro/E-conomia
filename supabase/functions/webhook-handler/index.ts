import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { MercadoLivre } from "../_shared/marketplace-clients.ts";

// ============================================================================
// Webhook Handler — Marketplaces (ECOM-76)
// Recebe notificações do ML: orders_v2, stock_locations, stock_fulfillment,
//   shipments, items
// ============================================================================

serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const marketplace = url.searchParams.get("marketplace");

  if (!marketplace) {
    return new Response(
      JSON.stringify({ error: "marketplace query param required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    console.log(`[webhook] marketplace=${marketplace} topic=${body.topic} resource=${body.resource}`);

    if (marketplace === "mercado_livre") {
      return await handleMLWebhook(body);
    } else if (marketplace === "nuvemshop") {
      return await handleNSWebhook(body);
    }

    return new Response(
      JSON.stringify({ error: `Marketplace "${marketplace}" not handled` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// =============================================================================
// Mercado Livre Webhook
// Tópicos: orders_v2, stock_locations, stock_fulfillment, shipments, items
// Payload: { resource, user_id, topic, application_id, attempts, sent, received }
// =============================================================================
async function handleMLWebhook(body: Record<string, any>): Promise<Response> {
  const supabase = getServiceClient();
  const { topic, user_id, resource } = body;

  // Buscar integração pelo seller_id
  const { data: integration } = await supabase
    .from("marketplace_integrations")
    .select("*")
    .eq("marketplace", "mercado_livre")
    .eq("seller_id", String(user_id))
    .eq("status", "active")
    .single();

  if (!integration) {
    console.warn(`[webhook] No active ML integration for user_id ${user_id}`);
    return jsonOk({ status: "ignored", reason: "no_integration" });
  }

  // Log de auditoria
  await supabase.from("sync_logs").insert({
    integration_id: integration.id,
    organization_id: integration.organization_id,
    event_type: `webhook_${topic}`,
    status: "started",
    metadata: body,
  });

  try {
    switch (topic) {
      case "orders_v2":
        await handleMLOrder(supabase, integration, resource);
        break;
      case "stock_locations":
        await handleMLStockLocations(supabase, integration, resource);
        break;
      case "stock_fulfillment":
        await handleMLStockFulfillment(supabase, integration, resource);
        break;
      case "shipments":
        await handleMLShipment(supabase, integration, resource);
        break;
      case "items":
        await handleMLItem(supabase, integration, resource);
        break;
      default:
        console.log(`[webhook] Unhandled ML topic: ${topic}`);
    }

    // Atualiza log para sucesso
    await supabase
      .from("sync_logs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("integration_id", integration.id)
      .eq("event_type", `webhook_${topic}`)
      .order("created_at", { ascending: false })
      .limit(1);

  } catch (err) {
    console.error(`[webhook] Error processing ${topic}:`, err);
    await supabase
      .from("sync_logs")
      .update({ status: "failed", error_message: String(err) })
      .eq("integration_id", integration.id)
      .eq("event_type", `webhook_${topic}`)
      .order("created_at", { ascending: false })
      .limit(1);
  }

  return jsonOk({ status: "processed", topic });
}

// ---------------------------------------------------------------------------
// orders_v2 — Pedido criado ou atualizado
// ---------------------------------------------------------------------------
async function handleMLOrder(
  supabase: ReturnType<typeof getServiceClient>,
  integration: Record<string, any>,
  resource: string
): Promise<void> {
  if (!resource) return;
  const orderId = resource.split("/").pop();

  const mlOrder = await fetchWithRetry(
    `https://api.mercadolibre.com/orders/${orderId}`,
    { headers: { Authorization: `Bearer ${integration.access_token}` } }
  );

  const grossAmount = mlOrder.total_amount ?? 0;
  const totalFee = mlOrder.order_items?.reduce(
    (acc: number, item: any) => acc + (item.sale_fee ?? 0) * (item.quantity ?? 1),
    0
  ) ?? 0;

  const buyerData = mlOrder.buyer
    ? { id: mlOrder.buyer.id, nickname: mlOrder.buyer.nickname, email: mlOrder.buyer.email }
    : null;

  const { data: order } = await supabase.from("orders").upsert(
    {
      organization_id: integration.organization_id,
      marketplace: "mercado_livre",
      marketplace_order_id: String(mlOrder.id),
      order_number: `ML-${mlOrder.id}`,
      status: mapMLStatus(mlOrder.status),
      gross_amount: grossAmount,
      marketplace_fee_amt: totalFee,
      marketplace_fee_percent: grossAmount > 0 ? (totalFee / grossAmount) * 100 : 0,
      buyer_data: buyerData,
      shipping_id: mlOrder.shipping?.id ? String(mlOrder.shipping.id) : null,
      marketplace_created_at: mlOrder.date_created,
      raw_data: mlOrder,
    },
    { onConflict: "organization_id,marketplace,marketplace_order_id", ignoreDuplicates: false }
  ).select("id, status").single();

  // Baixa automática de estoque ao aprovar pedido
  if (order && mlOrder.status === "paid") {
    for (const item of mlOrder.order_items ?? []) {
      const mlItemId = item.item?.id;
      const qty = item.quantity ?? 1;
      if (!mlItemId) continue;

      // Encontra produto pelo channel_sku
      const { data: cs } = await supabase
        .from("channel_stock")
        .select("id, product_id, quantity, reserved")
        .eq("organization_id", integration.organization_id)
        .eq("channel_sku", mlItemId)
        .single();

      if (!cs) continue;

      // Reserva via RPC ACID (ECOM-19 migration)
      const channel = mlOrder.shipping?.logistic_type === "fulfillment" ? "ml_full" : "ml_flex";
      await supabase.rpc("reserve_channel_stock", {
        p_org_id: integration.organization_id,
        p_product_id: cs.product_id,
        p_channel: channel,
        p_qty: qty,
      });

      // Log de movimentação
      await supabase.from("stock_movements").insert({
        organization_id: integration.organization_id,
        product_id: cs.product_id,
        channel,
        movement_type: "sale",
        quantity: -qty,
        reference_id: order?.id ?? null,
        notes: `Venda ML #${mlOrder.id}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// stock_locations — Mudança de estoque em qualquer origem ML
// ---------------------------------------------------------------------------
async function handleMLStockLocations(
  supabase: ReturnType<typeof getServiceClient>,
  integration: Record<string, any>,
  resource: string
): Promise<void> {
  if (!resource) return;

  // resource = "/user-products/{sellerId}/stock/locations/{locationId}"
  const parts = resource.split("/");
  const itemId = parts[2]; // user-products ID or item ID

  // Busca dados de estoque por localização via API ML
  const stockData = await fetchWithRetry(
    `https://api.mercadolibre.com${resource}`,
    { headers: { Authorization: `Bearer ${integration.access_token}` } }
  );

  if (!stockData?.locations) return;

  // Encontra o produto pelo channel_sku
  const { data: cs } = await supabase
    .from("channel_stock")
    .select("id, product_id")
    .eq("organization_id", integration.organization_id)
    .eq("channel_sku", itemId)
    .single();

  if (!cs) return;

  for (const loc of stockData.locations) {
    const locType = loc.type === "meli_facility"
      ? "meli_facility"
      : loc.type === "seller_warehouse"
        ? "seller_warehouse"
        : "flex_origin";

    await supabase.from("stock_locations").upsert(
      {
        organization_id: integration.organization_id,
        product_id: cs.product_id,
        channel_stock_id: cs.id,
        location_type: locType,
        location_id: String(loc.id ?? loc.location_id ?? locType),
        location_name: loc.name ?? locType,
        quantity: loc.quantity ?? 0,
        reserved: loc.reserved ?? 0,
        external_id: String(loc.id ?? locType),
        last_synced_at: new Date().toISOString(),
        sync_source: "webhook",
      },
      { onConflict: "product_id,location_type,location_id", ignoreDuplicates: false }
    );
  }

  // Atualiza channel_stock total
  const totalQty = stockData.locations.reduce((s: number, l: any) => s + (l.quantity ?? 0), 0);
  await supabase
    .from("channel_stock")
    .update({ quantity: totalQty, updated_at: new Date().toISOString() })
    .eq("id", cs.id);
}

// ---------------------------------------------------------------------------
// stock_fulfillment — Operações no estoque Full (FBM)
// ---------------------------------------------------------------------------
async function handleMLStockFulfillment(
  supabase: ReturnType<typeof getServiceClient>,
  integration: Record<string, any>,
  resource: string
): Promise<void> {
  if (!resource) return;

  const fulfillmentData = await fetchWithRetry(
    `https://api.mercadolibre.com${resource}`,
    { headers: { Authorization: `Bearer ${integration.access_token}` } }
  );

  if (!fulfillmentData) return;

  const itemId = fulfillmentData.item_id ?? fulfillmentData.seller_sku;
  if (!itemId) return;

  const { data: cs } = await supabase
    .from("channel_stock")
    .select("id, product_id")
    .eq("organization_id", integration.organization_id)
    .eq("channel_sku", String(itemId))
    .single();

  if (!cs) return;

  const newQty = fulfillmentData.available_quantity ?? fulfillmentData.quantity ?? 0;

  await supabase.from("stock_locations").upsert(
    {
      organization_id: integration.organization_id,
      product_id: cs.product_id,
      channel_stock_id: cs.id,
      location_type: "meli_facility",
      location_id: "ml_full_default",
      location_name: "Mercado Livre Full",
      quantity: newQty,
      reserved: fulfillmentData.reserved_quantity ?? 0,
      external_id: String(itemId),
      last_synced_at: new Date().toISOString(),
      sync_source: "webhook",
    },
    { onConflict: "product_id,location_type,location_id", ignoreDuplicates: false }
  );

  await supabase
    .from("channel_stock")
    .update({ quantity: newQty, updated_at: new Date().toISOString() })
    .eq("id", cs.id);

  // Log de movimentação
  await supabase.from("stock_movements").insert({
    organization_id: integration.organization_id,
    product_id: cs.product_id,
    channel: "ml_full",
    movement_type: "adjustment",
    quantity: newQty,
    notes: `Sync fulfillment webhook — novo total: ${newQty}`,
  });
}

// ---------------------------------------------------------------------------
// shipments — Atualização de status de envio
// ---------------------------------------------------------------------------
async function handleMLShipment(
  supabase: ReturnType<typeof getServiceClient>,
  integration: Record<string, any>,
  resource: string
): Promise<void> {
  if (!resource) return;
  const shipmentId = resource.split("/").pop();

  const shipmentData = await fetchWithRetry(
    `https://api.mercadolibre.com/shipments/${shipmentId}`,
    { headers: { Authorization: `Bearer ${integration.access_token}` } }
  );

  if (!shipmentData) return;

  const mlStatus = shipmentData.status;
  const orderId = shipmentData.order_id;
  if (!orderId) return;

  const orderStatus = mapShipmentToOrderStatus(mlStatus);

  await supabase
    .from("orders")
    .update({
      status: orderStatus,
      shipping_data: shipmentData,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", integration.organization_id)
    .eq("marketplace", "mercado_livre")
    .eq("shipping_id", String(orderId));
}

// ---------------------------------------------------------------------------
// items — Mudança em anúncio (preço, estoque, status)
// ---------------------------------------------------------------------------
async function handleMLItem(
  supabase: ReturnType<typeof getServiceClient>,
  integration: Record<string, any>,
  resource: string
): Promise<void> {
  if (!resource) return;
  const itemId = resource.split("/").pop();

  const item = await fetchWithRetry(
    `https://api.mercadolibre.com/items/${itemId}`,
    { headers: { Authorization: `Bearer ${integration.access_token}` } }
  );

  if (!item) return;

  const channel = item.shipping?.logistic_type === "fulfillment" ? "ml_full" : "ml_flex";

  await supabase.from("products").upsert(
    {
      organization_id: integration.organization_id,
      sku: item.id,
      name: item.title,
      sale_price: item.price ?? 0,
      image_url: item.thumbnail ?? null,
      category: item.category_id ?? null,
      is_active: item.status === "active",
    },
    { onConflict: "organization_id,sku", ignoreDuplicates: false }
  );

  // Atualiza channel_stock
  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("organization_id", integration.organization_id)
    .eq("sku", item.id)
    .single();

  if (product) {
    await supabase.from("channel_stock").upsert(
      {
        organization_id: integration.organization_id,
        product_id: product.id,
        channel,
        quantity: item.available_quantity ?? 0,
        channel_sku: item.id,
        channel_url: item.permalink ?? null,
      },
      { onConflict: "product_id,channel", ignoreDuplicates: false }
    );
  }
}

// =============================================================================
// Nuvemshop Webhook
// =============================================================================
async function handleNSWebhook(body: Record<string, any>): Promise<Response> {
  const supabase = getServiceClient();
  const { event, store_id } = body;

  const { data: integration } = await supabase
    .from("marketplace_integrations")
    .select("*")
    .eq("marketplace", "nuvemshop")
    .eq("seller_id", String(store_id))
    .eq("status", "active")
    .single();

  if (!integration) {
    return jsonOk({ status: "ignored" });
  }

  await supabase.from("sync_logs").insert({
    integration_id: integration.id,
    organization_id: integration.organization_id,
    event_type: `webhook_${event}`,
    status: "started",
    metadata: body,
  });

  if (event?.startsWith("order/")) {
    const orderId = body.id;
    if (orderId) {
      try {
        const { Nuvemshop } = await import("../_shared/marketplace-clients.ts");
        const nsOrder = await Nuvemshop.getOrder(
          integration.access_token,
          integration.seller_id,
          String(orderId)
        );
        const grossAmount = parseFloat(nsOrder.total ?? "0");
        await supabase.from("orders").upsert(
          {
            organization_id: integration.organization_id,
            marketplace: "nuvemshop",
            marketplace_order_id: String(nsOrder.id),
            order_number: `NUV-${nsOrder.number ?? nsOrder.id}`,
            status: mapNSStatus(nsOrder.status, nsOrder.payment_status),
            gross_amount: grossAmount,
            marketplace_fee_amt: 0,
            marketplace_fee_percent: 0,
            shipping_cost: parseFloat(nsOrder.shipping_cost_customer ?? "0"),
            marketplace_created_at: nsOrder.created_at,
            raw_data: nsOrder,
          },
          { onConflict: "organization_id,marketplace,marketplace_order_id", ignoreDuplicates: false }
        );
      } catch (err) {
        console.error(`[webhook] NS order ${orderId} error:`, err);
      }
    }
  }

  return jsonOk({ status: "processed", event });
}

// =============================================================================
// Helpers
// =============================================================================

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3
): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        // Rate limit — aguarda antes de tentar novamente
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapMLStatus(mlStatus: string): string {
  const map: Record<string, string> = {
    confirmed:            "approved",
    payment_required:     "pending",
    payment_in_process:   "pending",
    paid:                 "approved",
    cancelled:            "cancelled",
    partially_refunded:   "refunded",
    refunded:             "refunded",
  };
  return map[mlStatus] ?? "pending";
}

function mapShipmentToOrderStatus(shipStatus: string): string {
  const map: Record<string, string> = {
    pending:    "approved",
    handling:   "preparing",
    ready_to_ship: "preparing",
    shipped:    "shipped",
    delivered:  "delivered",
    not_delivered: "shipped",
    cancelled:  "cancelled",
  };
  return map[shipStatus] ?? "approved";
}

function mapNSStatus(status: string, paymentStatus?: string): string {
  if (status === "cancelled") return "cancelled";
  if (status === "closed") return "delivered";
  if (paymentStatus === "paid") return "approved";
  return "pending";
}
