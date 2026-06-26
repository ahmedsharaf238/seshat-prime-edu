// supabase/functions/check-mx/index.ts
// ============================================================
// 🌐 Email MX & Disposable Domain Validator - Edge Function
// تستخدم Deno.resolveDns لفحص MX Records بشكل موثوق
// ============================================================

// @ts-ignore: Deno std remote import may not be resolved by the editor/type checker
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

// قائمة النطاقات المؤقتة (محدثة)
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'yopmail.com', 'trashmail.com', '10minutemail.com',
  'tempmail.com', 'sharklasers.com', 'guerrillamail.com', 'dispostable.com',
  'temp-mail.org', 'throwawaymail.com', 'guerrillamail.info',
  'mailnator.com', 'spamgourmet.com', 'spambox.us', 'spam.la',
  'fakeinbox.com', 'getnada.com', 'mintemail.com', 'mytrashmail.com',
  'guerrillamail.net', 'guerrillamail.biz', 'guerrillamail.org',
  'guerrillamail.de', 'mailinator.net', 'mailinator.org',
  'yopmail.fr', 'yopmail.net', 'trashmail.net',
]);

serve(async (req: Request) => {
  // السماح فقط بـ POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Use POST.' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { domain } = await req.json();

    if (!domain || typeof domain !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Domain parameter is required and must be a string.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const normalizedDomain = domain.toLowerCase().trim();

    // 1. التحقق من البريد المؤقت (سريع)
    const isDisposable = DISPOSABLE_DOMAINS.has(normalizedDomain);

    // 2. التحقق من MX Records باستخدام Deno.resolveDns (الطريقة الأصلية)
    let hasMX = false;
    try {
      // Deno.resolveDns ترجع مصفوفة من سجلات MX
      const mxRecords = await (globalThis as any).Deno.resolveDns(normalizedDomain, "MX");
      hasMX = mxRecords && mxRecords.length > 0;
    } catch (dnsError) {
      // في حالة فشل DNS (مثل نطاق غير موجود)، نعتبره غير صالح
      const dnsErrorMessage = dnsError instanceof Error ? dnsError.message : String(dnsError);
      console.warn(`DNS lookup failed for ${normalizedDomain}:`, dnsErrorMessage);
      hasMX = false;
    }

    // 3. إرجاع النتيجة
    return new Response(
      JSON.stringify({
        hasMX,
        isDisposable,
        domain: normalizedDomain,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Error in check-mx function:', errorMessage);
      return new Response(
        JSON.stringify({
          hasMX: false,
          isDisposable: false,
          error: errorMessage || 'Internal server error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
});