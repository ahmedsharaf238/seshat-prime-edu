// supabase/functions/manage-reports/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import he from "he";

// 1. استدعاء متغيرات البيئة السرية
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "my-super-secret-cron-key"; // يمكنك تغييره

const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const CONCURRENCY_LIMIT = 5;

// 🖼️ رابط لوجو منصة Seshat Prime (ضع الرابط الحقيقي هنا)
const LOGO_URL = "https://your-website.com/images/seshat-prime-logo.png";

// إنشاء عميل سوبابيز بصلاحيات الخادم
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// دالة حماية النصوص
const escapeUserText = (text: string) => text ? he.escape(String(text)).trim() : "";

serve(async (req) => {
  // حظر أي طلب غير POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    // 🔒 التحقق من الأمان (جدار الحماية)
    const authHeader = req.headers.get("Authorization");
    const customSecretHeader = req.headers.get("X-Cron-Secret");

    if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` && customSecretHeader !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized access denied" }), { status: 401 });
    }

    // قراءة نوع التقرير (يومي، أسبوعي، شهري)
    const body = await req.json().catch(() => ({}));
    const reportType = body.type || "daily"; 

    const endDate = new Date();
    const startDate = new Date();

    if (reportType === "daily") {
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else if (reportType === "weekly") {
      startDate.setDate(startDate.getDate() - 7);
    } else if (reportType === "monthly") {
      startDate.setDate(startDate.getDate() - 30);
    } else {
      return new Response(JSON.stringify({ error: "Invalid report type" }), { status: 400 });
    }

    const result = await processAndSendReports(startDate, endDate, reportType);

    return new Response(JSON.stringify({ success: true, type: reportType, details: result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`🚨 خطأ:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});

async function processAndSendReports(startDate: Date, endDate: Date, reportType: string) {
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();
  
  const periodNameAr = reportType === "daily" ? "اليومي" : reportType === "weekly" ? "الأسبوعي" : "الشهري";

  // 1. جلب بيانات الطلاب وأولياء الأمور
  const { data: relations, error: relError } = await supabase
    .from("student_parents")
    .select(`parent_phone, telegram_chats!inner(chat_id), students(id, name, grade)`);

  if (relError || !relations || relations.length === 0) return { dispatched: 0 };

  const activeStudentIds = [...new Set(relations.map((r: any) => r.students?.id).filter(Boolean))];
  if (activeStudentIds.length === 0) return { dispatched: 0 };

  // 2. الجلب الشامل للبيانات (Bulk Fetch) - ضربة واحدة لقاعدة البيانات
  const [transactionsRes, examsRes, sessionsRes] = await Promise.all([
    supabase.from("wallet_transactions").select("student_id, amount").eq("type", "consume").gte("created_at", startISO).lte("created_at", endISO).in("student_id", activeStudentIds),
    supabase.from("exam_results").select("student_id, score, total").gte("created_at", startISO).lte("created_at", endISO).in("student_id", activeStudentIds),
    supabase.from("sessions").select("student_id, login_time, logout_time").gte("login_time", startISO).lte("login_time", endISO).in("student_id", activeStudentIds)
  ]);

  // 3. التجميع في الذاكرة (In-Memory Maps)
  const txMap = new Map();
  transactionsRes.data?.forEach(t => txMap.set(t.student_id, (txMap.get(t.student_id) || 0) + (t.amount || 0)));

  const examMap = new Map();
  examsRes.data?.forEach(e => {
    if (!examMap.has(e.student_id)) examMap.set(e.student_id, { count: 0, score: 0, total: 0 });
    const curr = examMap.get(e.student_id);
    curr.count++; curr.score += e.score || 0; curr.total += e.total || 0;
  });

  const sessionMap = new Map();
  sessionsRes.data?.forEach(s => {
    if (!sessionMap.has(s.student_id)) sessionMap.set(s.student_id, { count: 0, minutes: 0 });
    const curr = sessionMap.get(s.student_id);
    curr.count++;
    if (s.logout_time && s.login_time) {
      const diff = new Date(s.logout_time).getTime() - new Date(s.login_time).getTime();
      curr.minutes += Math.floor(diff / 60000);
    }
  });

  // 4. بناء تقارير أولياء الأمور
  const parentReports = new Map();
  for (const item of relations) {
    const chatId = item.telegram_chats?.chat_id;
    if (!chatId) continue;
    const student = item.students;
    if (!student) continue;

    const totalSpent = txMap.get(student.id) || 0;
    const examData = examMap.get(student.id) || { count: 0, score: 0, total: 0 };
    const sessionData = sessionMap.get(student.id) || { count: 0, minutes: 0 };
    const avgScore = examData.total > 0 ? Math.round((examData.score / examData.total) * 100) : 0;

    const childBlock = `👨‍🎓 <b>${escapeUserText(student.name)}</b> (${escapeUserText(student.grade)})\n   🕐 عدد الجلسات: ${sessionData.count}\n   ⏳ وقت المذاكرة: ${sessionData.minutes} دقيقة\n   💰 النقاط المستهلكة: ${totalSpent} نقطة\n   📝 الاختبارات: ${examData.count}\n   🏆 متوسط الدرجات: ${avgScore}%\n━━━━━━━━━━━━━━━━━`;

    if (!parentReports.has(chatId)) {
      parentReports.set(chatId, { phone: item.parent_phone, blocks: [] });
    }
    parentReports.get(chatId).blocks.push(childBlock);
  }

  // 5. الإرسال لتليجرام (صورة + نص التقرير)
  const reportEntries = Array.from(parentReports.entries());
  let countSuccess = 0;

  for (let i = 0; i < reportEntries.length; i += CONCURRENCY_LIMIT) {
    const chunk = reportEntries.slice(i, i + CONCURRENCY_LIMIT);

    await Promise.allSettled(chunk.map(async ([chatId, info]: any) => {
      const finalCaption = `📆 <b>التقرير ${periodNameAr} لأبنائكم</b>\nالفترة: من ${startDate.toLocaleDateString('ar-EG')} إلى ${endDate.toLocaleDateString('ar-EG')}\n\n${info.blocks.join('\n')}\n🤖 نظام المتابعة الآلي لمنصة Seshat Prime`;
      
      // إرسال الصورة ومعها التقرير
      const response = await fetch(`${API_URL}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          photo: "https://ljmtbfkkqguaduzjscfi.supabase.co/storage/v1/object/public/assets/logo.png",
          caption: finalCaption,
          parse_mode: "HTML",
        }),
      });
      if (response.ok) countSuccess++;
    }));

    if (i + CONCURRENCY_LIMIT < reportEntries.length) {
      await new Promise(resolve => setTimeout(resolve, 1300));
    }
  }

  return { dispatched: reportEntries.length, successful: countSuccess };
}