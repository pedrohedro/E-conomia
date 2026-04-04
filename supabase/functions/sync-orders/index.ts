import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { MercadoLivre, Nuvemshop } from "../_shared/marketplace-clients.ts";

// Sincroniza pedidos dos marketplaces conectados
// Pode ser chamada via Cron (a cada 5-15 min) ou manualmente
serve(async (req: Request) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const corsH = getCorsHeaders(req);
  const supabase = getServiceClient();

  // Buscar integracoes ativas
  let query = supabase
    .from("marketplace_integrations")
    .select("*")
    .eq("status", "active")
    .in("marketplace", ["mercado_livre", "nuvemshop"]);

  // Permite filtrar por org_id ou marketplace via body
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body.organization_id) {
        query = query.eq("organization_id", body.organization_id);
      }
      if (body.marketplace) {
        query = query.eq("marketplace", body.marketplace);
      }
    } catch { /* GET request or empty body */ }
  }

  const { data: integrations, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsH, "Content-Type": "application/json" },
    });
  }

  const results: Array<{
    integration_id: string;
    marketplace: string;
    orders_synced: number;
    error?: string;
  }> = [];

  for (const integration of integrations ?? []) {
    const logId = crypto.randomUUID();
    await supabase.from("sync_logs").insert({
      id: logId,
      integration_id: integration.id,
      organization_id: integration.organization_id,
      event_type: "orders_sync",
      status: "started",
    });

    try {
      let ordersSynced = 0;

      if (integration.marketplace === "mercado_livre") {
        ordersSynced = await syncMercadoLivreOrders(
          supabase,
          integration
        );
      } else if (integration.marketplace === "nuvemshop") {
        ordersSynced = await syncNuvemshopOrders(supabase, integration);
      }

      await supabase
        .from("sync_logs")
        .update({
          status: "success",
          records_processed: ordersSynced,
          finished_at: new Date().toISOString(),
        })
        .eq("id", logId);

      await supabase
        .from("marketplace_integrations")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_error: null,
        })
        .eq("id", integration.id);

      results.push({
        integration_id: integration.id,
        marketplace: integration.marketplace,
        orders_synced: ordersSynced,
      });
    } catch (err) {
      console.error(`Sync failed for ${integration.id}:`, err);

      await supabase
        .from("sync_logs")
        .update({
          status: "error",
          error_message: String(err),
          finished_at: new Date().toISOString(),
        })
        .eq("id", logId);

      await supabase
        .from("marketplace_integrations")
        .update({ last_sync_error: String(err) })
        .eq("id", integration.id);

      results.push({
        integration_id: integration.id,
        marketplace: integration.marketplace,
        orders_synced: 0,
        error: String(err),
      });
    }
  }

  return new Response(JSON.stringify({ synced: results.length, results }), {
    status: 200,
    headers: { ...corsH, "Content-Type": "application/json" },
  });
});

// =============================================================================
// Mercado Livre: buscar pedidos e inserir/atualizar no banco
// =============================================================================
async function syncMercadoLivreOrders(
  supabase: ReturnType<typeof getServiceClient>,
  integration: Record<string, any>
): Promise<number> {
  const dateFrom = integration.last_sync_at
    ? new Date(integration.last_sync_at).toISOString()
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 dias

  let offset = 0;
  let totalSynced = 0;
  let hasMore = true;

  while (hasMore) {
    const data = await MercadoLivre.getOrders(
      integration.access_token,
      integration.seller_id,
      { offset, limit: 50, dateFrom }
    );

    const orders = data.results ?? [];
    if (orders.length === 0) break;

    for (const mlOrder of orders) {
      await upsertMLOrder(supabase, integration, mlOrder);
      totalSynced++;
    }

    offset += orders.length;
    hasMore = offset < (data.paging?.total ?? 0);

    // Rate limit: 100ms entre requests
    await new Promise((r) => setTimeout(r, 100));
  }

  return totalSynced;
}

async function upsertMLOrder(
  supabase: ReturnType<typeof getServiceClient>,
  integration: Record<string, any>,
  mlOrder: Record<string, any>
) {
  const buyer = mlOrder.buyer ?? {};

  // Upsert customer
  const { data: customer } = await supabase
    .from("customers")
    .upsert(
      {
        organization_id: integration.organization_id,
        marketplace: "mercado_livre",
        marketplace_buyer_id: String(buyer.id),
        name: `${buyer.first_name ?? ""} ${buyer.last_name ?? ""}`.trim(),
        email: buyer.email,
        phone: buyer.phone?.number,
        city: buyer.billing_info?.city,
        state: buyer.billing_info?.state_id,
      },
      { onConflict: "organization_id,marketplace,marketplace_buyer_id", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  const statusMap: Record<string, string> = {
    confirmed: "approved",
    payment_required: "pending",
    payment_in_process: "pending",
    partially_paid: "pending",
    paid: "approved",
    partially_refunded: "delivered",
    cancelled: "cancelled",
  };

  const mlStatus = mlOrder.status ?? "unknown";
  const orderStatus = statusMap[mlStatus] ?? "pending";

  const firstItem = mlOrder.order_items?.[0];
  const grossAmount = mlOrder.total_amount ?? 0;
  const saleFee = firstItem?.sale_fee ?? 0;
  const totalFee = mlOrder.order_items?.reduce(
    (acc: number, item: any) => acc + (item.sale_fee ?? 0) * (item.quantity ?? 1),
    0
  ) ?? 0;
  const feePercent = grossAmount > 0 ? (totalFee / grossAmount) * 100 : 0;

  // Fulfillment type based on shipping
  let fulfillmentType = "ml_coleta";
  const shipping = mlOrder.shipping ?? {};
  if (shipping.logistic_type === "fulfillment") fulfillmentType = "ml_full";
  else if (shipping.logistic_type === "self_service") fulfillmentType = "ml_flex";

  const { data: order } = await supabase
    .from("orders")
    .upsert(
      {
        organization_id: integration.organization_id,
        marketplace: "mercado_livre",
        marketplace_order_id: String(mlOrder.id),
        order_number: `ML-${mlOrder.id}`,
        customer_id: customer?.id,
        status: orderStatus,
        fulfillment: fulfillmentType,
        gross_amount: grossAmount,
        marketplace_fee_pct: feePercent,
        marketplace_fee_amt: totalFee,
        shipping_cost: mlOrder.shipping?.cost ?? 0,
        discount_amount: mlOrder.coupon?.amount ?? 0,
        marketplace_created_at: mlOrder.date_created,
        raw_data: mlOrder,
      },
      { onConflict: "organization_id,marketplace,marketplace_order_id", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  if (!order) return;

  // Sync order items: delete existing then insert fresh
  await supabase.from("order_items").delete().eq("order_id", order.id);
  const itemsToInsert = (mlOrder.order_items ?? []).map((item: any) => ({
    order_id: order.id,
    organization_id: integration.organization_id,
    product_name: item.item?.title ?? "",
    sku: item.item?.seller_sku || item.item?.seller_custom_field || null,
    quantity: item.quantity ?? 1,
    unit_price: item.unit_price ?? 0,
  }));
  if (itemsToInsert.length > 0) {
    await supabase.from("order_items").insert(itemsToInsert);
  }
}

// =============================================================================
// Nuvemshop: buscar pedidos e inserir/atualizar no banco
// =============================================================================
async function syncNuvemshopOrders(
  supabase: ReturnType<typeof getServiceClient>,
  integration: Record<string, any>
): Promise<number> {
  const storeId = integration.seller_id ?? integration.config?.store_id;
  if (!storeId) throw new Error("Nuvemshop store_id not found in integration");

  const createdAtMin = integration.last_sync_at
    ? new Date(integration.last_sync_at).toISOString()
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let page = 1;
  let totalSynced = 0;
  let hasMore = true;

  while (hasMore) {
    const orders = await Nuvemshop.getOrders(
      integration.access_token,
      storeId,
      { page, perPage: 50, createdAtMin }
    );

    if (!Array.isArray(orders) || orders.length === 0) break;

    for (const nsOrder of orders) {
      await upsertNSOrder(supabase, integration, nsOrder, storeId);
      totalSynced++;
    }

    hasMore = orders.length === 50;
    page++;

    await new Promise((r) => setTimeout(r, 500)); // Nuvemshop rate limit
  }

  return totalSynced;
}

async function upsertNSOrder(
  supabase: ReturnType<typeof getServiceClient>,
  integration: Record<string, any>,
  nsOrder: Record<string, any>,
  _storeId: string
) {
  const customer = nsOrder.customer ?? {};

  const { data: dbCustomer } = await supabase
    .from("customers")
    .upsert(
      {
        organization_id: integration.organization_id,
        marketplace: "nuvemshop",
        marketplace_buyer_id: String(customer.id ?? nsOrder.id),
        name: customer.name ?? "",
        email: customer.email,
        phone: customer.phone,
        city: nsOrder.shipping_address?.city,
        state: nsOrder.shipping_address?.province,
      },
      { onConflict: "organization_id,marketplace,marketplace_buyer_id", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  const statusMap: Record<string, string> = {
    open: "pending",
    closed: "delivered",
    cancelled: "cancelled",
  };

  const nsStatus = nsOrder.status ?? "open";
  const paymentStatus = nsOrder.payment_status;
  let orderStatus = statusMap[nsStatus] ?? "pending";
  if (paymentStatus === "paid" && nsStatus === "open") orderStatus = "approved";

  const grossAmount = parseFloat(nsOrder.total ?? "0");
  const shippingCost = parseFloat(nsOrder.shipping_cost_customer ?? "0");
  const discount = parseFloat(nsOrder.discount ?? "0");

  const { data: order } = await supabase
    .from("orders")
    .upsert(
      {
        organization_id: integration.organization_id,
        marketplace: "nuvemshop",
        marketplace_order_id: String(nsOrder.id),
        order_number: `NUV-${nsOrder.number ?? nsOrder.id}`,
        customer_id: dbCustomer?.id,
        status: orderStatus,
        fulfillment: "correios_sedex",
        gross_amount: grossAmount,
        marketplace_fee_pct: 0, // Nuvemshop: sem taxa de marketplace
        marketplace_fee_amt: 0,
        shipping_cost: shippingCost,
        discount_amount: discount,
        marketplace_created_at: nsOrder.created_at,
        raw_data: nsOrder,
      },
      { onConflict: "organization_id,marketplace,marketplace_order_id", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  if (!order) return;

  // Sync order items: delete existing then insert fresh
  await supabase.from("order_items").delete().eq("order_id", order.id);
  const itemsToInsert = (nsOrder.products ?? []).map((product: any) => ({
    order_id: order.id,
    organization_id: integration.organization_id,
    product_name: product.name ?? "",
    sku: product.sku || null,
    quantity: product.quantity ?? 1,
    unit_price: parseFloat(product.price ?? "0"),
  }));
  if (itemsToInsert.length > 0) {
    await supabase.from("order_items").insert(itemsToInsert);
  }
}
