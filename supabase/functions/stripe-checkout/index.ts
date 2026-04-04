import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleCors, getCorsHeaders } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const PLANS: Record<string, string> = {
  starter: Deno.env.get('STRIPE_PRICE_STARTER') ?? '',
  pro:     Deno.env.get('STRIPE_PRICE_PRO') ?? '',
};

serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: getCorsHeaders(req),
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: getCorsHeaders(req),
      });
    }

    const { plan, successUrl, cancelUrl } = await req.json();

    if (!PLANS[plan]) {
      return new Response(JSON.stringify({ error: 'Plano inválido' }), {
        status: 400, headers: getCorsHeaders(req),
      });
    }

    const { data: member } = await supabase
      .from('org_members')
      .select('organization_id, organizations(name)')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Organização não encontrada' }), {
        status: 400, headers: getCorsHeaders(req),
      });
    }

    const orgId = member.organization_id;

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('organization_id', orgId)
      .maybeSingle();

    let customerId = sub?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: (member.organizations as Record<string, string>)?.name ?? '',
        metadata: { organization_id: orgId, user_id: user.id },
      });
      customerId = customer.id;

      await supabase.from('subscriptions').upsert({
        organization_id: orgId,
        stripe_customer_id: customerId,
        plan: 'free',
        status: 'active',
      }, { onConflict: 'organization_id' });
    }

    const frontendUrl = Deno.env.get('FRONTEND_URL') ?? '';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PLANS[plan], quantity: 1 }],
      success_url: successUrl ?? `${frontendUrl}/settings.html?upgraded=true`,
      cancel_url:  cancelUrl  ?? `${frontendUrl}/settings.html`,
      subscription_data: { metadata: { organization_id: orgId } },
      locale: 'pt-BR',
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('stripe-checkout error:', err);
    return new Response(JSON.stringify({ error: 'Erro interno' }), {
      status: 500, headers: getCorsHeaders(req),
    });
  }
});
