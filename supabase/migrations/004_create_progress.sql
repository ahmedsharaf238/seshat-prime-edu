-- ==============================================================================
-- 004_create_progress.sql
-- تقدم مشاهدة الفيديو (نسخة مضادة للغش ومحسنة للأداء العالي)
-- ==============================================================================

CREATE TABLE video_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
  watched_seconds INTEGER DEFAULT 0 CHECK (watched_seconds >= 0),
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(), -- تم تعديل الاسم ليتوافق مع التريجر القياسي
  UNIQUE(user_id, video_id)
);

-- فهارس لتسريع استعلامات التقدم
CREATE INDEX idx_video_progress_user ON video_progress(user_id);
CREATE INDEX idx_video_progress_completed ON video_progress(is_completed);

ALTER TABLE video_progress ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- سياسات الأمان (RLS)
-- ==========================================

-- 1. الطالب (رؤية فقط) - التحديث يتم عبر الدالة الآمنة أسفله
CREATE POLICY "Students view own progress" ON video_progress 
  FOR SELECT 
  USING (auth.uid() = user_id);

-- 2. المشرفون (رؤية فقط) لدعم الطلاب
CREATE POLICY "Supervisors view all progress" ON video_progress 
  FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('supervisor', 'owner')));

-- 3. المالك (God Mode)
CREATE POLICY "Owner manages all progress" ON video_progress 
  FOR ALL 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- ==========================================
-- الدالة الآمنة لتحديث التقدم (RPC) - Anti-Cheat
-- ==========================================
CREATE OR REPLACE FUNCTION sync_video_progress(
  p_video_id UUID, 
  p_incremental_seconds INTEGER, 
  p_video_duration INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  v_max_allowed_increment INTEGER := 65; -- أقصى زيادة مسموحة في الطلب الواحد (لنفترض أن الرفع يتم كل 60 ثانية)
BEGIN
  -- 1. حماية ضد التلاعب: إذا أرسل الهاكر زيادة ضخمة، نُحجمها للحد الأقصى المسموح
  IF p_incremental_seconds > v_max_allowed_increment THEN
    p_incremental_seconds := v_max_allowed_increment;
  END IF;

  -- 2. الإضافة أو التحديث (Upsert)
  INSERT INTO video_progress (user_id, video_id, watched_seconds)
  VALUES (auth.uid(), p_video_id, p_incremental_seconds)
  ON CONFLICT (user_id, video_id)
  DO UPDATE SET
    watched_seconds = video_progress.watched_seconds + p_incremental_seconds,
    updated_at = NOW();

  -- 3. تفعيل حالة "مكتمل" تلقائياً إذا تخطى 90% من الفيديو
  UPDATE video_progress
  SET is_completed = true, completed_at = NOW()
  WHERE user_id = auth.uid() 
    AND video_id = p_video_id
    AND watched_seconds >= (p_video_duration * 0.90) -- نسبة 90% كافية لاعتباره أكمل الدرس
    AND is_completed = false;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- تريجر تحديث الوقت
CREATE TRIGGER update_video_progress_updated_at
  BEFORE UPDATE ON video_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();