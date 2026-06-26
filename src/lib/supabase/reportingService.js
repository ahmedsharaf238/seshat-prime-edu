// src/lib/supabase/reportingService.js
// 📊 Ultra-Performance Reporting Engine v5.1.0 (Zero-Leak & Bulk-Optimized)

import { supabase } from './supabaseClient';
import { notifyParentAboutChildren } from './telegramService'; // استيراد دالة الإرسال المستقرة

/**
 * 🚀 المحرك الموحد الفائق لإنتاج وتقسيم التقارير الدورية بأقل تكلفة موارد ممكنة
 */
const sendReportForPeriod = async (startDate, endDate, periodName) => {
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  console.log(`⏳ [Bulk Cron] جاري تجميع بيانات التقرير ${periodName} للفترة من [${startISO}] إلى [${endISO}]...`);

  // الخطوة 1: جلب شبكة العلاقات بالكامل وتجهيز قنوات الاتصال (Single Database Hit)
  const { data: relations, error: relError } = await supabase
    .from('student_parents')
    .select(`
      parent_phone,
      profiles!student_parents_parent_phone_fkey(full_name),
      telegram_chats!inner(chat_id),
      students(id, name, grade)
    `);

  if (relError || !relations || relations.length === 0) {
    console.warn('⚠️ لم يتم العثور على علاقات نشطة بين أولياء الأمور والطلاب.');
    return;
  }

  // استخراج كافة معرفات الطلاب النشطين بدون تكرار لتصفية استعلامات التجميع
  const activeStudentIds = [...new Set(relations.map(r => r.students?.id).filter(Boolean))];
  
  if (activeStudentIds.length === 0) return;

  // الخطوة 2: سحب البيانات التجميعية الشاملة دفعة واحدة من قاعدة البيانات (تصفير استعلامات Loops)
  const [transactionsRes, examsRes, sessionsRes] = await Promise.all([
    supabase.from('wallet_transactions').select('student_id, amount').eq('type', 'consume').gte('created_at', startISO).lte('created_at', endISO).in('student_id', activeStudentIds),
    supabase.from('exam_results').select('student_id, score, total').gte('created_at', startISO).lte('created_at', endISO).in('student_id', activeStudentIds),
    supabase.from('sessions').select('student_id, login_time, logout_time').gte('login_time', startISO).lte('login_time', endISO).in('student_id', activeStudentIds)
  ]);

  // الخطوة 3: بناء خريطة الفهرسة السريعة (Hashing Maps) في الذاكرة للوصول الفوري O(1)
  const txMap = new Map();
  transactionsRes.data?.forEach(t => {
    txMap.set(t.student_id, (txMap.get(t.student_id) || 0) + (t.amount || 0));
  });

  const examMap = new Map();
  examsRes.data?.forEach(e => {
    if (!examMap.has(e.student_id)) examMap.set(e.student_id, { count: 0, score: 0, total: 0 });
    const curr = examMap.get(e.student_id);
    curr.count++;
    curr.score += e.score || 0;
    curr.total += e.total || 0;
  });

  const sessionMap = new Map();
  sessionsRes.data?.forEach(s => {
    if (!sessionMap.has(s.student_id)) sessionMap.set(s.student_id, { count: 0, minutes: 0 });
    const curr = sessionMap.get(s.student_id);
    curr.count++;
    if (s.logout_time && s.login_time) {
      const diff = new Date(s.logout_time) - new Date(s.login_time);
      curr.minutes += Math.floor(diff / 60000);
    }
  });

  // الخطوة 4: تجميع أولياء الأمور وبناء الرسائل الهيكلية بدون أي طلبات إضافية للشبكة
  const parentReports = new Map();

  for (const item of relations) {
    const chatId = item.telegram_chats?.chat_id;
    if (!chatId) continue;

    const student = item.students;
    if (!student) continue;

    // جلب البيانات من خرائط الذاكرة بسرعة فائقة
    const totalSpent = txMap.get(student.id) || 0;
    const examData = examMap.get(student.id) || { count: 0, score: 0, total: 0 };
    const sessionData = sessionMap.get(student.id) || { count: 0, minutes: 0 };

    const avgScore = examData.total > 0 
      ? parseFloat(((examData.score / examData.total) * 100).toFixed(2)) 
      : 0;

    // صياغة النص الخاص بالابن الحالي
    const childBlock = `
👨‍🎓 <b>${student.name}</b> (${student.grade})
   🕐 عدد مرات الدخول: ${sessionData.count} جولات
   ⏳ وقت المذاكرة: ${sessionData.minutes} دقيقة
   💰 النقاط المستهلكة: ${totalSpent} نقطة
   📝 الامتحانات المؤداة: ${examData.count} اختبارات
   🏆 متوسط الدرجات الكلي: ${avgScore}%
━━━━━━━━━━━━━━━━━`;

    if (!parentReports.has(chatId)) {
      parentReports.set(chatId, {
        phone: item.parent_phone,
        blocks: []
      });
    }
    parentReports.get(chatId).blocks.push(childBlock);
  }

  // الخطوة 5: بث الرسائل دفعة واحدة عبر خط المعالجة المحمي لتفادي الـ Rate Limit لـ Telegram
  const reportEntries = Array.from(parentReports.entries());
  const CONCURRENCY_LIMIT = 5;

  for (let i = 0; i < reportEntries.length; i += CONCURRENCY_LIMIT) {
    const chunk = reportEntries.slice(i, i + CONCURRENCY_LIMIT);

    await Promise.allSettled(chunk.map(async ([chatId, info]) => {
      const finalMessage = `📆 <b>التقرير ${periodName} للأبناء</b>\nالفترة: من ${startDate.toLocaleDateString('ar-EG')} إلى ${endDate.toLocaleDateString('ar-EG')}\n\n${info.blocks.join('\n')}\n\n🤖 نظام المتابعة الآلي لمنصة Seshat Prime`;
      return notifyParentAboutChildren(info.phone, finalMessage);
    }));

    // انتظار بسيط لحماية البوت من الحظر المؤقت للتليجرام
    if (i + CONCURRENCY_LIMIT < reportEntries.length) {
      await new Promise(resolve => setTimeout(resolve, 1300));
    }
  }

  console.log(`✅ [Bulk Cron] تم إنهاء بث التقارير ${periodName} لجميع أولياء الأمور بنجاح.`);
};

/**
 * 🟢 التقرير اليومي (يغطي آخر 24 ساعة من بداية اليوم)
 */
export const sendDailyReportToAllParents = async () => {
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const endOfDay = new Date(today.setHours(23, 59, 59, 999));
  await sendReportForPeriod(startOfDay, endOfDay, 'اليومي');
};

/**
 * 🟡 التقرير الأسبوعي (آخر 7 أيام كاملة)
 */
export const sendWeeklyReportToAllParents = async () => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);
  await sendReportForPeriod(startDate, endDate, 'الأسبوعي');
};

/**
 * 🔴 التقرير الشهري (آخر 30 يوماً)
 */
export const sendMonthlyReportToAllParents = async () => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  await sendReportForPeriod(startDate, endDate, 'الشهري');
};

export default {
  sendDailyReportToAllParents,
  sendWeeklyReportToAllParents,
  sendMonthlyReportToAllParents
};