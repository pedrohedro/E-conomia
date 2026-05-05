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
    const body = await req.json();
    const { order_id, organization_id } = body;

    if (!order_id || !organization_id) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400 });
    }

    // 1. Fetch Tiny Configuration for this organization
    const { data: config, error: configError } = await supabase
      .from("partner_fulfillment_configs")
      .select("tiny_token_enc, tiny_deposit_id, sync_orders")
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .single();

    if (configError || !config) {
      return new Response(JSON.stringify({ error: "Tiny configuration not found or inactive" }), { status: 404 });
    }

    if (!config.sync_orders) {
       return new Response(JSON.stringify({ message: "Order sync is disabled for this organization" }), { status: 200 });
    }

    // NOTE: In a real implementation, you would decrypt tiny_token_enc here via a secure RPC 
    // or KMS before using it. For now, assuming it's available or using a global env var if Master account.
    const tinyToken = Deno.env.get("TINY_ERP_MASTER_TOKEN") || "dummy_token";

    // 2. Fetch Order Details from local DB
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        *,
        order_items(*)
      `)
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found");
    }

    // 3. Transform to Tiny ERP XML/JSON Payload
    // According to Tiny API, it requires specific XML or JSON format
    const tinyPayload = {
      pedido: {
        data_pedido: order.created_at.split('T')[0],
        cliente: {
          nome: order.buyer_nickname || "Cliente Mercado Livre",
          cpf_cnpj: order.buyer_document || "00000000000"
        },
        itens: order.order_items.map((item: any) => ({
          item: {
            codigo: item.sku,
            descricao: item.title,
            unidade: "UN",
            quantidade: item.quantity,
            valor_unitario: item.unit_price
          }
        })),
        nome_transportador: order.shipping_carrier || "Correios",
        forma_frete: "FOB",
        valor_frete: order.shipping_cost || 0,
        id_deposito: config.tiny_deposit_id
      }
    };

    // 4. Send to Tiny ERP
    const tinyUrl = `https://api.tiny.com.br/api2/pedidos.incluir.php`;
    
    // Convert to URL-encoded format as required by Tiny for form-urlencoded with JSON param
    const params = new URLSearchParams();
    params.append('token', tinyToken);
    params.append('formato', 'JSON');
    params.append('pedido', JSON.stringify(tinyPayload));

    const tinyRes = await fetch(tinyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    const resultText = await tinyRes.text();
    let resultJson;
    try {
       resultJson = JSON.parse(resultText);
    } catch {
       resultJson = { raw: resultText };
    }

    // 5. Log synchronization
    const isSuccess = resultJson.retorno && resultJson.retorno.status === 'OK';
    await supabase.from("tiny_sync_logs").insert({
      organization_id,
      sync_type: "order_push",
      entity_id: order_id,
      tiny_id: isSuccess ? resultJson.retorno.registros.registro.numero : null,
      status: isSuccess ? "success" : "error",
      payload_sent: tinyPayload,
      response_body: resultJson,
      error_message: isSuccess ? null : JSON.stringify(resultJson)
    });

    return new Response(JSON.stringify({ success: isSuccess, tiny_response: resultJson }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Error in tiny-sync-orders:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
