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
    const { product_id, organization_id } = body;

    if (!product_id || !organization_id) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400 });
    }

    const { data: config, error: configError } = await supabase
      .from("partner_fulfillment_configs")
      .select("*")
      .eq("organization_id", organization_id)
      .eq("is_active", true)
      .single();

    if (configError || !config || !config.sync_products) {
      return new Response(JSON.stringify({ message: "Product sync disabled or not configured" }), { status: 200 });
    }

    const tinyToken = Deno.env.get("TINY_ERP_MASTER_TOKEN") || "dummy_token";

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("id", product_id)
      .single();

    if (productError || !product) {
      throw new Error("Product not found");
    }

    const tinyPayload = {
      produtos: [
        {
          produto: {
            sequencia: "1",
            nome: product.name,
            codigo: product.sku,
            unidade: "UN",
            preco: product.price || 0,
            origem: "0",
            situacao: "A",
            tipo: "P"
          }
        }
      ]
    };

    const tinyUrl = `https://api.tiny.com.br/api2/produtos.incluir.php`;
    const params = new URLSearchParams();
    params.append('token', tinyToken);
    params.append('formato', 'JSON');
    params.append('produtos', JSON.stringify(tinyPayload));

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

    const isSuccess = resultJson.retorno && resultJson.retorno.status === 'OK';
    
    await supabase.from("tiny_sync_logs").insert({
      organization_id,
      sync_type: "product_push",
      entity_id: product_id,
      tiny_id: isSuccess ? resultJson.retorno.registros[0].registro.id : null,
      status: isSuccess ? "success" : "error",
      payload_sent: tinyPayload,
      response_body: resultJson,
      error_message: isSuccess ? null : JSON.stringify(resultJson)
    });

    return new Response(JSON.stringify({ success: isSuccess, tiny_response: resultJson }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Error in tiny-sync-products:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
