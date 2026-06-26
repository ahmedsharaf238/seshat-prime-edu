-- ==============================================================================
-- 002_create_videos.sql
-- جدول الفيديوهات التعليمية (النسخة المحصنة والمطورة للإدارة المطلقة)
-- ==============================================================================

CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  youtube_video_id TEXT NOT NULL,
  youtube_channel_id TEXT,
  thumbnail_url TEXT,                        -- صورة مصغرة زاهية الألوان ومبهجة للدرس
  attached_pdf_url TEXT,                     -- رابط مذكرة الدرس (PDF)
  duration_seconds INTEGER,
  grade_level grade_level NOT NULL,          -- مرتبط بأنواع المراحل (إعدادي/ثانوي) من الملف 001
  subject TEXT,
  order_index INTEGER DEFAULT 0,
  
  -- 💰 نظام الدفع والقيود المالية
  is_free BOOLEAN DEFAULT true,              -- هل الفيديو مجاني؟
  points_cost INTEGER DEFAULT 0 CHECK (points_cost >= 0), -- عدد النقاط لفتح الفيديو
  
  -- 🛡️ الحماية والترابط
  is_active BOOLEAN DEFAULT true,            -- للتعطيل بدلاً من الحذف
  is_ghost_mode BOOLEAN DEFAULT true,        -- ⬅️ زر تفعيل (الختم المائي وشريط الأخبار) للحماية
  prerequisite_video_id UUID REFERENCES videos(id), -- قفل الدرس حتى يتم الانتهاء من درس آخر
  
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 🔒 القيود الفولاذية (Constraints)
-- ==============================================================================

-- قيد: التدقيق المالي الصارم لمنع الأخطاء في التسعير
ALTER TABLE videos ADD CONSTRAINT videos_cost_check
  CHECK ( 
    (is_free = true AND points_cost = 0) OR 
    (is_free = false AND points_cost > 0) 
  );

-- ==============================================================================
-- ⚡ فهارس لتسريع التحميل (Performance Indexes)
-- ==============================================================================
CREATE INDEX idx_videos_grade ON videos(grade_level);
CREATE INDEX idx_videos_active ON videos(is_active);
CREATE INDEX idx_videos_order ON videos(order_index);

-- ==============================================================================
-- 🛡️ جدار الحماية (Row Level Security - RLS)
-- ==============================================================================
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

-- 1. للجميع (طلاب، أولياء أمور، مشرفين): رؤية الفيديوهات "النشطة" فقط
CREATE POLICY "Anyone can view active videos"
  ON videos FOR SELECT
  USING (is_active = true);

-- 2. سيطرة المالك (God Mode): المالك يرى كل شيء (نشط ومخفي) وله حق الإضافة والتعديل والحذف
CREATE POLICY "Strict Owner Only Manipulation"
  ON videos FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- 🚫 ملاحظة هامة: لا توجد أي سياسات تسمح للمشرفين بالإدراج (INSERT) أو التحديث (UPDATE) أو الحذف (DELETE).
-- المشرف محظور تماماً من التعديل المباشر هنا، وسيستخدم جدول (pending_requests) لإرسال طلباته للمالك فقط.

-- ==============================================================================
-- 🔄 الموظف الآلي (Triggers)
-- ==============================================================================

-- Trigger لتحديث توقيت (updated_at) تلقائياً عند أي تعديل يقوم به المالك
CREATE TRIGGER update_videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();