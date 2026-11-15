# iMarket4U WA — Phase 1

This is the first deployable foundation for `wa.imarket4u.co.zw`.

## Included
- Node.js + Express dashboard
- Baileys WhatsApp connection
- Pairing-code login (no QR UI)
- Persistent multi-file auth session
- Connection/activity dashboard
- Initial group anti-link moderation:
  - detects common URLs and WhatsApp/group links
  - ignores group admins
  - deletes the offending message
  - removes the non-admin sender

## Not yet enabled
- automatic status viewing/reactions
- multi-user SaaS accounts
- billing
- advanced group rules
- AI
- plugin store

Those should be added after the first connection test is working.

## Deploy
1. Upload this ZIP through the WebPros/cPanel Node.js app deployment screen.
2. Set the startup file to `server.js`.
3. Set the application URL to `https://wa.imarket4u.co.zw`.
4. Install dependencies with the hosting panel's build/install action.
5. Start/restart the application.
6. Open the domain.

## Environment
Copy `.env.example` to `.env` if the panel does not create one automatically.

## Pairing number
Use country code + national number, digits only. For Zimbabwe, for example:
`263771234567`
not `+263 77 123 4567`.

## Important
The Baileys project is an unofficial WhatsApp Web client library, not the official WhatsApp Business Platform. Use it responsibly and comply with WhatsApp's terms and applicable law.
