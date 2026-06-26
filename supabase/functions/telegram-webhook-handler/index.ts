// supabase/functions/telegram-webhook-handler/index.ts
// 🚀 Telegram Webhook Handler - متوافق مع البنية الحالية لقاعدة البيانات

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabaseClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const MASTER_TEACHER_CHAT_ID = Deno.env.get('MASTER_TEACHER_CHAT_ID');

async function sendTelegram(chatId: string, text: string) {
  if (!BOT_TOKEN || !chatId) return;
  try {
    await fetch(`${API_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.substring(0, 4096),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch (e) { console.error('Telegram send failed:', e); }
}

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${Deno.env.get('WEBHOOK_SECRET')}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const payload = await req.json();
    const { table, type, record } = payload;

    // =========================================================
    // 1️⃣ حالة: عملية شحن (جدول wallet_transactions)
    //    ملاحظة: trigger_wallet_charge موجود بالفعل في قاعدة البيانات!
    // =========================================================
    if (table === 'wallet_transactions' && type === 'INSERT' && record.amount > 0) {
      const { student_id, amount, created_by } = record;
      
      const { data: student } = await supabaseClient
        .from('students') // افترض وجود جدول students
        .select('name, parent_phone')
        .eq('id', student_id)
        .single();

      // إشعار ولي الأمر
      if (student?.parent_phone) {
        const { data: parentChat } = await supabaseClient
          .from('telegram_chats')
          .select('chat_id')
          .eq('phone', student.parent_phone)
          .single();
        if (parentChat) {
          await sendTelegram(
            parentChat.chat_id,
            `💰 <b>تم شحن رصيد ابنك</b>\n👨‍🎓 ${student.name}\n💵 ${amount} نقطة`
          );
        }
      }

      // إشعار المعلم (الكنج)
      if (MASTER_TEACHER_CHAT_ID) {
        await sendTelegram(
          MASTER_TEACHER_CHAT_ID,
          `🤑 <b>شحن جديد</b>\n👨‍🎓 ${student?.name || 'غير معروف'}\n💰 ${amount} نقطة`
        );
      }
    }

    // =========================================================
    // 2️⃣ حالة: انتهاء محاولة امتحان (جدول exam_attempts)
    // =========================================================
    else if (table === 'exam_attempts' && type === 'INSERT' && record.status === 'completed') {
      const { student_id, exam_id, score, total } = record;

      const { data: student } = await supabaseClient
        .from('students')
        .select('name, phone, parent_phone')
        .eq('id', student_id)
        .single();

      const { data: exam } = await supabaseClient
        .from('exams')
        .select('title')
        .eq('id', exam_id)
        .single();

      // إشعار الطالب
      const { data: studentChat } = await supabaseClient
        .from('telegram_chats')
        .select('chat_id')
        .eq('phone', student?.phone)
        .single();
      if (studentChat) {
        await sendTelegram(
          studentChat.chat_id,
          `📝 <b>نتيجة اختبارك</b>\n📘 ${exam?.title || 'امتحان'}\n🎯 ${score}/${total}`
        );
      }

      // إشعار ولي الأمر
      if (student?.parent_phone) {
        const { data: parentChat } = await supabaseClient
          .from('telegram_chats')
          .select('chat_id')
          .eq('phone', student.parent_phone)
          .single();
        if (parentChat) {
          await sendTelegram(
            parentChat.chat_id,
            `📝 <b>نتيجة اختبار ابنك</b>\n👨‍🎓 ${student.name}\n📘 ${exam?.title}\n🎯 ${score}/${total}`
          );
        }
      }

      // إشعار المعلم
      if (MASTER_TEACHER_CHAT_ID) {
        await sendTelegram(
          MASTER_TEACHER_CHAT_ID,
          `📊 <b>نتيجة اختبار</b>\n👨‍🎓 ${student?.name}\n📘 ${exam?.title}\n🎯 ${score}/${total}`
        );
      }
    }

    // =========================================================
    // 3️⃣ حالة: طلب موافقة جديد (جدول approval_requests) - بدلاً من tickets
    // =========================================================
    else if (table === 'approval_requests' && type === 'INSERT') {
      const { id, student_id, request_type, message, status } = record;

      const { data: student } = await supabaseClient
        .from('students')
        .select('name, parent_phone')
        .eq('id', student_id)
        .single();

      // إشعار جميع المشرفين
      const { data: supervisors } = await supabaseClient
        .from('profiles')
        .select('telegram_chat_id')
        .eq('role', 'supervisor')
        .not('telegram_chat_id', 'is', null);

      if (supervisors) {
        const text = `🆕 <b>طلب موافقة جديد</b>\n👨‍🎓 ${student?.name || 'طالب'}\n📝 ${request_type || 'طلب'}\n📄 ${message?.substring(0, 200) || ''}\n🔗 للرد: /approve_${id}`;
        for (const sup of supervisors) {
          await sendTelegram(sup.telegram_chat_id, text);
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // نسخة للمعلم
      if (MASTER_TEACHER_CHAT_ID) {
        await sendTelegram(
          MASTER_TEACHER_CHAT_ID,
          `📩 <b>طلب موافقة جديد (نسخة للمعلم)</b>\n👨‍🎓 ${student?.name}\n📝 ${message}`
        );
      }
    }

    // =========================================================
    // 4️⃣ حالة: إشعار نظام جديد (جدول notifications) - اختياري
    // =========================================================
    else if (table === 'notifications' && type === 'INSERT') {
      const { recipient_id, message, type } = record;
      
      // جلب chat_id الخاص بالمستلم
      const { data: userChat } = await supabaseClient
        .from('telegram_chats')
        .select('chat_id')
        .eq('user_id', recipient_id) // افترض وجود user_id
        .single();
      
      if (userChat) {
        await sendTelegram(
          userChat.chat_id,
          `🔔 <b>إشعار جديد</b>\n${message}`
        );
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error('🔥 Webhook Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});