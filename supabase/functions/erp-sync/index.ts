import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

import { pushToOlistHub, pushToOmie, ErpOrderPayload } from "./drivers.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { orderId } = await req.json();

    if (!orderId) {
      throw new Error("orderId is required");
    }

    // 1. Buscar o pedido completo (com itens e cliente)
    // Usamos a função RPC para descriptografar tokens se necessário
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        *,
        order_items (*),
        organizations!inner (
          id,
          marketplace_integrations (*)
        )
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) throw new Error(`Order not found: ${orderError?.message}`);

    // 2. Identificar integração de fulfillment ativa (Olist Hub ou Omie)
    const erpIntegration = order.organizations.marketplace_integrations.find(
      (m: any) => (m.marketplace === 'erp_olist_hub' || m.marketplace === 'erp_omie') && m.status === 'active'
    );

    if (!erpIntegration) {
      return new Response(JSON.stringify({ message: "No active fulfillment integration" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Preparar Payload Unificado
    const payload: ErpOrderPayload = {
      order_id: order.marketplace_order_id || order.id,
      customer: {
        name: order.customer_name,
        doc: order.customer_document,
        email: order.customer_email,
        phone: order.customer_phone
      },
      address: order.shipping_address, // JSONB
      items: order.order_items.map((item: any) => ({
        sku: item.sku,
        name: item.product_name,
        qty: item.quantity,
        price: item.unit_price
      })),
      shipping_cost: order.shipping_cost,
      total: order.total_amount
    };

    // 4. Executar Driver
    let result;
    const config = erpIntegration.config;
    
    // TODO: Recuperar tokens descriptografados via RPC get_decrypted_integration
    const { data: secureData } = await supabase.rpc('get_decrypted_integration', { p_id: erpIntegration.id });
    const fullConfig = { ...config, access_token: secureData?.[0]?.access_token, app_key: secureData?.[0]?.config?.app_key, app_secret: secureData?.[0]?.config?.app_secret };

    if (erpIntegration.marketplace === 'erp_olist_hub') {
      result = await pushToOlistHub(payload, fullConfig);
    } else {
      result = await pushToOmie(payload, fullConfig);
    }

    // 5. Atualizar Pedido e Salvar Log
    await supabase.from("orders").update({ 
      external_erp_id: result.id || result.codigo_pedido_omie,
      external_erp_status: 'sent'
    }).eq("id", order.id);

    await supabase.from("erp_sync_logs").insert({
      organization_id: order.organization_id,
      order_id: order.id,
      erp_type: erpIntegration.marketplace,
      direction: 'outbound',
      method: 'PushOrder',
      payload,
      response: result,
      status_code: 200
    });

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
