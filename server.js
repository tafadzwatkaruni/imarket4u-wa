import 'dotenv/config'
import express from 'express'
import pino from 'pino'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  jidNormalizedUser
} from '@whiskeysockets/baileys'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.PORT || 3000)
const AUTH_DIR = path.resolve(__dirname, process.env.AUTH_DIR || './data/auth')
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'

fs.mkdirSync(AUTH_DIR, { recursive: true })

const logger = pino({ level: LOG_LEVEL })
const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let sock = null
let connectionState = 'disconnected'
let connectedNumber = null
let pairingInProgress = false
let lastPairingCode = null
const activity = []

function addActivity(type, detail) {
  activity.unshift({
    time: new Date().toISOString(),
    type,
    detail
  })
  if (activity.length > 100) activity.length = 100
}

function normalizePhone(value) {
  return String(value || '').replace(/[\\s+()\\-]/g, '')
}

function isValidPhone(value) {
  return /^\\d{8,15}$/.test(value)
}

function hasLink(text) {
  if (!text) return false
  return /(https?:\\/\\/|www\\.|chat\\.whatsapp\\.com\\/|wa\\.me\\/|t\\.me\\/|bit\\.ly\\/|tinyurl\\.com\\/)/i.test(text)
}

function getTextFromMessage(message) {
  if (!message) return ''
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ''
  )
}

async function isGroupAdmin(jid, participant) {
  try {
    const metadata = await sock.groupMetadata(jid)
    const normalized = jidNormalizedUser(participant)
    const member = metadata.participants.find(p => jidNormalizedUser(p.id) === normalized)
    return member?.admin === 'admin' || member?.admin === 'superadmin'
  } catch (error) {
    logger.warn({ error }, 'Could not read group metadata')
    return false
  }
}

async function handleGroupMessage(msg) {
  if (!sock || !msg?.key?.remoteJid?.endsWith('@g.us')) return
  const sender = msg.key.participant || msg.key.remoteJid
  const text = getTextFromMessage(msg.message)
  if (!hasLink(text)) return

  // Never moderate messages sent by group admins.
  if (await isGroupAdmin(msg.key.remoteJid, sender)) {
    addActivity('admin_link_allowed', `${sender} posted a link`)
    return
  }

  try {
    await sock.sendMessage(msg.key.remoteJid, { delete: msg.key })
    addActivity('link_deleted', `${sender} in ${msg.key.remoteJid}`)

    await sock.groupParticipantsUpdate(
      msg.key.remoteJid,
      [sender],
      'remove'
    )
    addActivity('member_removed', `${sender} from ${msg.key.remoteJid}`)
  } catch (error) {
    logger.error({ error }, 'Anti-link action failed')
    addActivity('moderation_error', error?.message || 'Unknown error')
  }
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu('iMarket4U WA'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    connectionState = connection || 'connecting'

    // Pairing code is requested after the connection/QR event.
    if (qr && pairingInProgress && !state.creds.registered && !lastPairingCode) {
      try {
        const phone = globalThis.__pendingPhone
        if (!phone) return
        lastPairingCode = await sock.requestPairingCode(phone)
        addActivity('pairing_code_generated', `Pairing code generated for ${phone}`)
      } catch (error) {
        logger.error({ error }, 'Pairing code generation failed')
        addActivity('pairing_error', error?.message || 'Pairing failed')
        pairingInProgress = false
      }
    }

    if (connection === 'open') {
      connectedNumber = sock.user?.id ? jidNormalizedUser(sock.user.id).split('@')[0] : null
      pairingInProgress = false
      lastPairingCode = null
      addActivity('connected', connectedNumber || 'WhatsApp connected')
      logger.info({ connectedNumber }, 'WhatsApp connected')
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut

      logger.warn({ statusCode, loggedOut }, 'WhatsApp connection closed')
      connectionState = loggedOut ? 'logged_out' : 'disconnected'

      if (!loggedOut) {
        // Give the socket a moment to settle before reconnecting.
        setTimeout(() => startWhatsApp().catch(err => logger.error({ err }, 'Reconnect failed')), 3000)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages || []) {
      await handleGroupMessage(msg)
    }
  })
}

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    app: process.env.APP_NAME || 'iMarket4U WA',
    connection: connectionState,
    connectedNumber,
    pairingCode: lastPairingCode,
    pairingInProgress,
    activity: activity.slice(0, 30)
  })
})

app.post('/api/pair', async (req, res) => {
  if (pairingInProgress) {
    return res.status(409).json({ ok: false, error: 'A pairing request is already in progress.' })
  }

  const phone = normalizePhone(req.body?.phone)
  if (!isValidPhone(phone)) {
    return res.status(400).json({
      ok: false,
      error: 'Enter the WhatsApp number with country code, numbers only. Example: 263771234567'
    })
  }

  try {
    globalThis.__pendingPhone = phone
    lastPairingCode = null
    pairingInProgress = true
    connectionState = 'connecting'

    if (!sock || sock.authState?.creds?.registered) {
      // Start a fresh socket for the initial pairing flow.
      await startWhatsApp()
    }

    // In some environments the QR event can take a moment to arrive.
    // The frontend polls /api/status while the code is generated.
    return res.json({ ok: true, message: 'Pairing started. Waiting for the code.' })
  } catch (error) {
    pairingInProgress = false
    logger.error({ error }, 'Pairing start failed')
    return res.status(500).json({ ok: false, error: error?.message || 'Could not start pairing.' })
  }
})

app.post('/api/disconnect', async (req, res) => {
  try {
    if (sock) {
      await sock.logout()
    }
    sock = null
    connectedNumber = null
    connectionState = 'disconnected'
    addActivity('disconnected', 'WhatsApp session logged out')
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'Could not disconnect.' })
  }
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  logger.info(`iMarket4U WA listening on port ${PORT}`)
  // If a saved session exists, reconnect automatically.
  startWhatsApp().catch(err => logger.error({ err }, 'Initial WhatsApp start failed'))
})
