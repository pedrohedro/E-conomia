const { run } = require("graphile-worker");

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("FATAL: SUPABASE_DB_URL is not provided (must be Postgres transaction connection pool)");
    process.exit(1);
  }

  // Iniciando o Runner do Graphile com as definições de Filas.
  const runner = await run({
    connectionString,
    concurrency: 20, // Pools configuradas via Supavisor Transaction Pool
    taskList: {
      sync_marketplace_order: async (payload, helpers) => {
        // payload expects: { org_id: uuid, marketplace: string, external_order_id: string }
        helpers.logger.info(`Sincronizando pedido: ${payload.external_order_id} no marketplace ${payload.marketplace}`);
        // Lógica de resgate REST API seria alocada aqui
      },
      update_channel_stock: async (payload, helpers) => {
        // payload expects: { org_id: uuid, channel: string, product_id: uuid, quantity: int }
        helpers.logger.info(`Notificando marketplace: SKU de prod ${payload.product_id} no canal ${payload.channel}`);
      }
    },
  });

  console.log("E-conomia Worker successfully started. Polling Supabase for jobs...");

  await runner.promise;
}

main().catch((err) => {
  console.error("Runner Failed:", err);
  process.exit(1);
});
