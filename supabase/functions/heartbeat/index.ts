// supabase/functions/heartbeat/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// إعدادات الـ CORS للسماح للمتصفح بالاتصال
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // 1️⃣ الاستجابة لطلبات الـ Preflight (مهم جداً للمتصفحات)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 2️⃣ استخراج البيانات من الـ FormData
    const formData = await req.formData();
    const userId = formData.get('user_id')?.toString();
    const lastSeen = formData.get('last_seen')?.toString();
    const path = formData.get('path')?.toString();
    const isFinal = formData.get('is_final') === 'true';

    if (!userId || !lastSeen) {
      throw new Error('Missing required fields: user_id or last_seen');
    }

    // 3️⃣ تهيئة Supabase بصلاحيات الـ Service Role
    // نستخدم الـ Service Key لأن sendBeacon لا يرسل Auth Token
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // 4️⃣ استدعاء الـ RPC لتحديث آخر ظهور
    const { error } = await supabase.rpc('update_last_seen', {
      p_user_id: userId,
      p_seen_at: lastSeen,
      p_path: path
    });

    if (error) {
      console.error('DB Update Error:', error);
      throw error;
    }

    // تسجيل في الـ Logs السحابية إذا كانت الإشارة نهائية (للمراقبة)
    if (isFinal) {
      console.log(`🚪 User ${userId} disconnected. Last path: ${path}`);
    }

    // 5️⃣ إرجاع استجابة بالنجاح
    return new Response(
      JSON.stringify({ success: true, message: 'Heartbeat recorded' }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Edge Function Error:', error.message);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})