// supabase/functions/send_telegram_notification/index.ts
const env = (globalThis as any).Deno?.env ?? (globalThis as any).process?.env
const getEnv = (key: string) => {
  if (!env) return undefined
  if (typeof env.get === 'function') return env.get(key)
  return env[key]
}

const TELEGRAM_BOT_TOKEN = getEnv('TELEGRAM_BOT_TOKEN')
const ADMIN_CHAT_ID = getEnv('ADMIN_CHAT_ID')

const DenoServe = (globalThis as any).Deno?.serve
if (!DenoServe) throw new Error('Deno.serve not available')

DenoServe(async (req: Request) => {
  try {
    const { chat_id, message } = await req.json()
    
    if (!TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN not set')
    }

    const targetChatId = chat_id || ADMIN_CHAT_ID
    
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
        parse_mode: 'HTML'
      })
    })

    const result = await response.json()
    return new Response(JSON.stringify({ success: result.ok, result }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})