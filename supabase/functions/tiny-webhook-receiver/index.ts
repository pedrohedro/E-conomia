import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Tiny ERP webhooks typically send URL-encoded forms or JSON with specific properties.
    // Example: {"tipo": "estoque", "idProduto": "123", "estoque": "50"} or order status updates.
    const bodyText = await req.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      // Handle x-www-form-urlencoded if Tiny sends it that way
      const params = new URLSearchParams(bodyText);
      body = Object.fromEntries(params.entries());
    }

    // Determine webhook type
    // In a real implementation, we would map the incoming data (like `body.tipo`)
    const webhookType = body.tipo || body.type || "unknown";

    if (webhookType === "estoque") {
       // Find product by SKU or ID
       const sku = body.sku || body.codigo;
       const qty = parseInt(body.estoque || body.saldo || "0", 10);
       const depositId = body.id_deposito;

       // Find the organization that owns this deposit
       const { data: config } = await supabase
         .from("partner_fulfillment_configs")
         .select("organization_id")
         .eq("tiny_deposit_id", depositId)
         .single();
         
       if (config) {
          // Update stock_locations for 'partner_fulfillment'
          // First we need the product id
          const { data: product } = await supabase
             .from("products")
             .select("id")
             .eq("sku", sku)
             .eq("organization_id", config.organization_id)
             .single();
             
          if (product) {
             await supabase.from("stock_locations").upsert({
                organization_id: config.organization_id,
                product_id: product.id,
                location_type: 'partner_fulfillment',
                location_id: depositId,
                quantity: qty,
                sync_source: 'webhook',
                last_synced_at: new Date().toISOString()
             }, { onConflict: 'product_id,location_type,location_id' });
          }
       }
    } 
    else if (webhookType === "pedido" || webhookType === "expedicao") {
       // Order status update (e.g. shipped, tracking number added)
       const tinyOrderId = body.idPedido || body.id_pedido;
       const trackingNumber = body.codigoRastreamento || body.tracking;
       // ... logic to update order status and notify Mercado Livre ...
    }

    return new Response(JSON.stringify({ status: "success" }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Error in tiny-webhook-receiver:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
