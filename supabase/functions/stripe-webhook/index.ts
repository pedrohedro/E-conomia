import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== 'subscription') break;
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const orgId = subscription.metadata.organization_id;
        const plan = getPlanFromPriceId(subscription.items.data[0].price.id);
        await supabase.from('subscriptions').upsert({
          organization_id: orgId,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscription.id,
          plan, status: subscription.status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end:   new Date(subscription.current_period_end   * 1000).toISOString(),
          trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
          cancel_at_period_end: subscription.cancel_at_period_end,
        }, { onConflict: 'organization_id' });
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata.organization_id;
        const plan = getPlanFromPriceId(sub.items.data[0].price.id);
        await supabase.from('subscriptions').update({
          plan, status: sub.status,
          current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
          current_period_end:   new Date(sub.current_period_end   * 1000).toISOString(),
          trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          cancel_at_period_end: sub.cancel_at_period_end,
          canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq('organization_id', orgId);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await supabase.from('subscriptions').update({
          plan: 'free', status: 'canceled',
          stripe_subscription_id: null, cancel_at_period_end: false,
          canceled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('organization_id', sub.metadata.organization_id);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const orgId = invoice.subscription_details?.metadata?.organization_id;
        if (orgId && invoice.status === 'paid') {
          await supabase.from('stripe_invoices').upsert({
            organization_id: orgId,
            stripe_invoice_id: invoice.id,
            stripe_customer_id: invoice.customer as string,
            amount_paid: invoice.amount_paid, currency: invoice.currency,
            status: invoice.status, invoice_pdf: invoice.invoice_pdf,
            period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
            period_end:   invoice.period_end   ? new Date(invoice.period_end   * 1000).toISOString() : null,
          }, { onConflict: 'stripe_invoice_id' });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        if (sub.metadata.organization_id) {
          await supabase.from('subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('organization_id', sub.metadata.organization_id);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return new Response('Handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});

function getPlanFromPriceId(priceId: string): string {
  if (priceId === (Deno.env.get('STRIPE_PRICE_STARTER') ?? '')) return 'starter';
  if (priceId === (Deno.env.get('STRIPE_PRICE_PRO')     ?? '')) return 'pro';
  return 'starter';
}
