import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { MercadoLivre } from "../_shared/marketplace-clients.ts";

// Recebe notificacoes/webhooks dos marketplaces
// ML: https://api.mercadolibre.com/notifications
// NS: webhooks configurados no app
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
// Topicos: orders_v2, items, payments, shipments
// Payload: { resource, user_id, topic, application_id, attempts, sent, received }
// =============================================================================
async function handleMLWebhook(body: Record<string, any>): Promise<Response> {
  const supabase = getServiceClient();
  const { topic, user_id, resource } = body;

  // Buscar integracao pelo seller_id (user_id do ML)
  const { data: integration } = await supabase
    .from("marketplace_integrations")
    .select("*")
    .eq("marketplace", "mercado_livre")
    .eq("seller_id", String(user_id))
    .eq("status", "active")
    .single();

  if (!integration) {
    console.warn(`No active ML integration for user_id ${user_id}`);
    return new Response(JSON.stringify({ status: "ignored", reason: "no_integration" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.from("sync_logs").insert({
    integration_id: integration.id,
    organization_id: integration.organization_id,
    event_type: `webhook_${topic}`,
    status: "started",
    metadata: body,
  });

  if (topic === "orders_v2" && resource) {
    // resource = "/orders/123456789"
    const orderId = resource.split("/").pop();
    try {
      const mlOrder = await MercadoLivre.getOrder(
        integration.access_token,
        orderId
      );

      // Reutiliza a logica de upsert do sync-orders
      // Importar diretamente nao e possivel em Edge Functions separadas,
      // entao fazemos inline simplificado aqui
      const grossAmount = mlOrder.total_amount ?? 0;
      const totalFee = mlOrder.order_items?.reduce(
        (acc: number, item: any) => acc + (item.sale_fee ?? 0) * (item.quantity ?? 1),
        0
      ) ?? 0;

      await supabase.from("orders").upsert(
        {
          organization_id: integration.organization_id,
          marketplace: "mercado_livre",
          marketplace_order_id: String(mlOrder.id),
          order_number: `ML-${mlOrder.id}`,
          status: mapMLStatus(mlOrder.status),
          gross_amount: grossAmount,
          marketplace_fee_amt: totalFee,
          marketplace_fee_percent: grossAmount > 0 ? (totalFee / grossAmount) * 100 : 0,
          marketplace_created_at: mlOrder.date_created,
          raw_data: mlOrder,
        },
        { onConflict: "organization_id,marketplace,marketplace_order_id", ignoreDuplicates: false }
      );
    } catch (err) {
      console.error(`Failed to process ML order ${orderId}:`, err);
    }
  }

  return new Response(JSON.stringify({ status: "processed" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// =============================================================================
// Nuvemshop Webhook
// Events: order/created, order/updated, order/paid, order/fulfilled, etc.
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
    return new Response(JSON.stringify({ status: "ignored" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await supabase.from("sync_logs").insert({
    integration_id: integration.id,
    organization_id: integration.organization_id,
    event_type: `webhook_${event}`,
    status: "started",
    metadata: body,
  });

  // Para qualquer evento de order, trigger um sync incremental
  if (event?.startsWith("order/")) {
    // A Nuvemshop envia o ID do pedido no body
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
        console.error(`Failed to process NS order ${orderId}:`, err);
      }
    }
  }

  return new Response(JSON.stringify({ status: "processed" }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapMLStatus(mlStatus: string): string {
  const map: Record<string, string> = {
    confirmed: "approved",
    payment_required: "pending",
    payment_in_process: "pending",
    paid: "approved",
    cancelled: "cancelled",
  };
  return map[mlStatus] ?? "pending";
}

function mapNSStatus(status: string, paymentStatus?: string): string {
  if (status === "cancelled") return "cancelled";
  if (status === "closed") return "delivered";
  if (paymentStatus === "paid") return "approved";
  return "pending";
}
