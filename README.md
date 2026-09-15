# ♠️ Teen Patti Chips - Real-Time Multiplayer Web App

A modern, real-time multiplayer virtual chips tracker and turn manager for **Teen Patti** card games with friends. Designed for mobile phones and web browsers, complete with live pot tracking, Teen Patti rules engine (Blind/Seen chaals, Pack/Fold, Side Show, Show), Web Audio sound synthesizers, and instant device synchronization via **Supabase Realtime**.

---

## 🌟 Key Features

- **📱 Room System**: Host creates a table and gets a 6-character Room Code or QR Code. Friends scan/enter code from their phones to join instantly.
- **🔄 Real-time Turn & Action Sync**: Live update of turns, pot balance, player statuses (Blind / Seen / Pack / Dealer), and active bet requirements.
- **🃏 Teen Patti Rules Engine**:
  - **Boot Collection**: Auto-deducts boot amount from active players at round start.
  - **Blind vs. Seen Math**: Blind players bet 1x min chaal; Seen players bet 2x min chaal.
  - **Actions**: Pack/Fold, Blind/Seen toggle, Chaal (Bet/Raise), Side Show request & response, and Winner Payouts.
- **🔊 Web Audio API Synthesizers**: Realistic chip clinking sounds, turn notifications, card fold swooshes, and victory fanfares without external audio files.
- **📊 Real-time Leaderboard & Log**: Track chip standings and full round action history.
- **🌐 1-Click Vercel & Supabase Ready**: Built using Vite and Supabase Realtime client.

---

## 🚀 Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Run local dev server
npm run dev
```

Open `http://localhost:5173` in your browser. You can open multiple browser tabs or devices on the same Wi-Fi to test room joining and turn syncing!

---

## ⚡ 1-Minute Supabase Backend Setup

For global real-time synchronization across different networks and phones:

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** in your Supabase Dashboard.
3. Copy the contents of `supabase_setup.sql` in this repo and click **Run**.
4. Get your **Project URL** and **anon public API Key** from `Project Settings -> API`.
5. Set environment variables in `.env` (or in Vercel settings):
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```
   *Note: You can also enter your Supabase URL & Key directly inside the app's **Backend Settings** modal on any device!*

---

## 🚀 Deploy to Vercel

1. Push this repository to GitHub / GitLab / Bitbucket.
2. Go to [vercel.com](https://vercel.com) -> **Add New Project**.
3. Import your repository (Vercel automatically detects Vite).
4. Add Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Click **Deploy**! 🚀

---

## 📁 File Structure

- `src/main.js`: Main UI controller, rendering, room router, modal dialogs.
- `src/teenPattiEngine.js`: Teen Patti game rules reducer, turn order, chaal logic, side show, winner payouts.
- `src/supabase.js`: Supabase Client + Realtime broadcast channel + local BroadcastChannel fallback.
- `src/audio.js`: Pure Web Audio API sound synthesizer for casino SFX.
- `src/style.css`: Casino dark mode theme, glassmorphic UI, turn indicators, mobile bottom bar.
- `supabase_setup.sql`: Ready-to-run database table & realtime subscription SQL script.
