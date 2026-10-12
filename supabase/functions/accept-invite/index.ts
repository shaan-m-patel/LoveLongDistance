import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type CoupleProfilePayload = {
  id: string;
  meId: string;
  partner: {
    id: string;
    firstName: string;
    displayName?: string | null;
  };
  reunionDate?: string;
};

type AcceptInviteResult = {
  ok?: boolean;
  error?: string;
  couple?: CoupleProfilePayload;
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function statusForInviteError(code: string): number {
  switch (code) {
    case 'token_required':
    case 'cannot_accept_own_invite':
      return 400;
    case 'invalid_session':
      return 401;
    case 'invite_not_found':
      return 404;
    case 'invite_expired':
      return 410;
    case 'invite_already_used':
    case 'already_paired':
    case 'already_member':
    case 'couple_full':
      return 409;
    default:
      return 500;
  }
}

function knownErrorFromMessage(message: string): string | null {
  const codes = [
    'partner_not_found',
    'couple_update_failed',
    'couple_full',
    'membership_failed',
    'invite_already_used',
  ];
  return codes.find((code) => message.includes(code)) ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'missing_authorization' }, 401);
    }

    const jwt = authHeader.slice('Bearer '.length).trim();
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: authErr } = await admin.auth.getUser(jwt);
    if (authErr || !userData.user) {
      return json({ error: 'invalid_session' }, 401);
    }
    const user = userData.user;

    const body = (await req.json().catch(() => ({}))) as { token?: string };
    const token = String(body.token ?? '').trim();
    if (!token) {
      return json({ error: 'token_required' }, 400);
    }

    const { data, error } = await admin.rpc('accept_couple_invite', {
      p_token: token,
      p_acceptor_id: user.id,
    });

    if (error) {
      console.error(error);
      const code = knownErrorFromMessage(error.message) ?? 'internal_error';
      return json({ error: code }, statusForInviteError(code));
    }

    const result = (data ?? null) as AcceptInviteResult | null;
    if (!result?.ok || !result.couple?.id || !result.couple.partner?.id) {
      const code = result?.error ?? 'internal_error';
      return json({ error: code }, statusForInviteError(code));
    }

    const couple: CoupleProfilePayload = {
      id: result.couple.id,
      meId: result.couple.meId,
      partner: {
        id: result.couple.partner.id,
        firstName: result.couple.partner.firstName,
        displayName: result.couple.partner.displayName ?? undefined,
      },
      reunionDate: result.couple.reunionDate,
    };

    return json({ couple }, 200);
  } catch (e) {
    console.error(e);
    return json({ error: 'internal_error' }, 500);
  }
});
