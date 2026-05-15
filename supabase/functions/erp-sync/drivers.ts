// ============================================================================
// ERP/Hub Drivers for Fulfillment
// Standardizes communication with Olist Hub and Omie
// ============================================================================

export interface ErpOrderPayload {
  order_id: string;
  customer: {
    name: string;
    doc: string;
    email: string;
    phone: string;
  };
  address: {
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zip: string;
  };
  items: Array<{
    sku: string;
    name: string;
    qty: number;
    price: number;
  }>;
  shipping_cost: number;
  total: number;
}

/**
 * Driver para Olist Hub (Partners API)
 * Docs: https://developers.olist.com/
 */
export async function pushToOlistHub(payload: ErpOrderPayload, config: any) {
  const url = `${Deno.env.get("OLIST_API_BASE") || 'https://partners-api.olist.com/v1'}/orders`;
  
  // Exemplo de mapeamento para o Olist Hub
  const body = {
    external_id: payload.order_id,
    customer: {
      name: payload.customer.name,
      document: payload.customer.doc,
      email: payload.customer.email,
    },
    items: payload.items.map(item => ({
      sku: item.sku,
      quantity: item.qty,
      unit_price: item.price
    })),
    // Olist Hub tem campos específicos de logística
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return response.json();
}

/**
 * Driver para Omie ERP (JSON-RPC)
 * Docs: https://developer.omie.com.br/
 */
export async function pushToOmie(payload: ErpOrderPayload, config: any) {
  const url = 'https://app.omie.com.br/api/v1/produtos/pedido/';
  
  const body = {
    call: "IncluirPedidoVenda",
    app_key: config.app_key,
    app_secret: config.app_secret,
    param: [{
      cabecalho: {
        codigo_pedido_integracao: payload.order_id,
        data_previsao: new Date().toLocaleDateString('pt-BR'),
        etapa: "10" // Aguardando Aprovação
      },
      detalhes: payload.items.map(item => ({
        produto: {
          codigo_produto_integracao: item.sku
        },
        quantidade: item.qty,
        valor_unitario: item.price
      })),
      frete: {
        valor_frete: payload.shipping_cost
      }
    }]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  return response.json();
}
