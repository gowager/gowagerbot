# 🚀 How To Make GoWager Live - Complete Beginner's Guide (100% Free)

This guide will walk you through making GoWager live on the internet **completely free** using:
- **Visual Studio Code** - Your code editor (already installed)
- **GitHub** - Free code hosting
- **Vercel** - Free hosting for the web app & Telegram mini app
- **Render** - Free hosting for the backend (Node.js)
- **Neon.tech** - Free PostgreSQL database
- **Telegram BotFather** - Free Telegram bot creation

**Total cost: $0.00**

---

## 📋 What You Need Before Starting

1. A **GitHub account** (free) - [github.com](https://github.com)
2. A **Vercel account** (free) - [vercel.com](https://vercel.com)
3. A **Neon.tech account** (free) - [neon.tech](https://neon.tech)
4. A **Render account** (free) - [render.com](https://render.com)
5. A **Telegram account** (free)
6. **Visual Studio Code** (already installed on your computer)

> ⏱️ **Time needed**: About 30-45 minutes total

---

## 🗄️ Step 1: Set Up the Database (Neon.tech)

Neon.tech gives you a free PostgreSQL database in the cloud.

1. Go to [neon.tech](https://neon.tech) and click **Sign Up**
2. Sign up with **GitHub** (easiest) or email
3. After signing in, click **Create Project**
4. Name it `gowager`
5. Choose a region close to you (e.g., `US East` or `EU West`)
6. Click **Create Project**
7. You'll see a **connection string** that looks like:
   ```
   postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/gowager?sslmode=require
   ```
8. **Copy this connection string** - you'll need it in Step 3
9. Keep this tab open

---

## 📦 Step 2: Push Your Code to GitHub

GitHub stores your code online for free.

### 2a. Create a GitHub Repository

1. Go to [github.com](https://github.com) and sign in
2. Click the **+** icon in the top right → **New repository**
3. Name it `gowager`
4. Click **Create repository** (leave everything else as default)
5. You'll see a page with commands - keep it open

### 2b. Push Your Code from VS Code

1. Open **VS Code**
2. Open the GoWager project folder:
   - Click **File** → **Open Folder**
   - Select `c:\Users\ASL STUDIOS\Desktop\nb88`
3. Open the **Terminal** in VS Code:
   - Click **Terminal** → **New Terminal**
4. Type these commands one by one (press Enter after each):

```bash
git init
git add .
git commit -m "Initial GoWager commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/gowager.git
git push -u origin main
```

> ⚠️ Replace `YOUR_USERNAME` with your actual GitHub username.

5. If it asks for login, a browser window will open - just click **Authorize**

Your code is now on GitHub! 🎉

---

## 🖥️ Step 3: Deploy the Backend (Render)

Render hosts your Node.js backend for free.

1. Go to [render.com](https://render.com) and click **Sign Up**
2. Sign up with **GitHub** (easiest)
3. Click **New** → **Web Service**
4. Connect your GitHub account and select the `gowager` repository
5. Fill in the settings:
   - **Name**: `gowager-backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
6. Scroll down to **Environment Variables** and add:
   - **Key**: `DATABASE_URL`
   - **Value**: Paste your Neon.tech connection string from Step 1
   - **Key**: `PORT`
   - **Value**: `3001`
7. Click **Create Web Service**
8. Wait 2-5 minutes for it to build and deploy
9. Once done, you'll get a URL like: `https://gowager-backend.onrender.com`
10. **Copy this URL** - you'll need it for the frontend

> ⚠️ **Important**: Render free tier sleeps after 15 minutes of inactivity. The first request after sleep takes ~30 seconds to wake up. This is normal.

---

## 🌐 Step 4: Deploy the Web App (Vercel)

Vercel hosts your web app for free.

1. Go to [vercel.com](https://vercel.com) and click **Sign Up**
2. Sign up with **GitHub**
3. Click **Add New** → **Project**
4. Select the `gowager` repository
5. In the **Root Directory** dropdown, select `webapp`
6. Click **Deploy**
7. Wait for deployment to complete
8. You'll get a URL like: `https://gowager-webapp.vercel.app`

### Update the API URL in the web app:

1. Open `webapp/app.js` in VS Code
2. Find this line (near the top):
   ```javascript
   const API_URL = 'http://localhost:3001';
   ```
3. Change it to:
   ```javascript
   const API_URL = 'https://gowager-backend.onrender.com';
   ```
4. Save the file
5. Push to GitHub (in VS Code terminal):
   ```bash
   git add .
   git commit -m "Update API URL"
   git push
   ```
6. Vercel will automatically redeploy

---

## 📱 Step 5: Deploy the Telegram Mini App (Vercel)

1. Go to [vercel.com](https://vercel.com)
2. Click **Add New** → **Project**
3. Select the `gowager` repository
4. In the **Root Directory** dropdown, select `telegram`
5. Click **Deploy**
6. You'll get a URL like: `https://gowager-telegram.vercel.app`

### Update the API URL in the Telegram app:

1. Open `telegram/app.js` in VS Code
2. Find this line (near the top):
   ```javascript
   const API_URL = 'https://gowager-backend.vercel.app';
   ```
3. Change it to:
   ```javascript
   const API_URL = 'https://gowager-backend.onrender.com';
   ```
4. Save and push to GitHub:
   ```bash
   git add .
   git commit -m "Update Telegram API URL"
   git push
   ```

---

## 🤖 Step 6: Create the Telegram Bot

1. Open **Telegram** on your phone or computer
2. Search for **@BotFather** (the official bot creator)
3. Start a chat and send `/newbot`
4. Give your bot a name: `GoWager`
5. Give it a username: `gowager_bot` (must end in `bot`)
6. BotFather will give you a **bot token** - save it somewhere safe
7. Now send `/newapp` to BotFather
8. Select your bot
9. Give the app a title: `GoWager`
10. Give it a short name: `gowager`
11. Upload a description (e.g., "Wager with friends. Play games. Win real money.")
12. Upload a photo (optional)
13. Set the **Web App URL** to: `https://gowager-telegram.vercel.app`
14. Set the **Web App Name**: `gowager`
15. Done! Your bot now has a Mini App

### Test your bot:

1. Open your bot in Telegram
2. Click the **Menu** button (or the Web App button)
3. Your GoWager Mini App should open

---

## 🔧 Step 7: Configure CORS (Important!)

The backend needs to allow requests from your frontend domains.

1. Open `backend/server.js` in VS Code
2. Find this line:
   ```javascript
   app.use(cors());
   ```
3. Change it to:
   ```javascript
   app.use(cors({
     origin: [
       'https://gowager-webapp.vercel.app',
       'https://gowager-telegram.vercel.app'
     ]
   }));
   ```
4. Save and push to GitHub:
   ```bash
   git add .
   git commit -m "Configure CORS"
   git push
   ```
5. Render will automatically redeploy

---

## ✅ Step 8: Test Everything

1. **Web App**: Open `https://gowager-webapp.vercel.app`
2. **Telegram Mini App**: Open your bot in Telegram and click the app button
3. **Play Free**: Click "Play Free with Friends" to play without money
4. **Play for Money**: Click "Wager with Friends" to play with real stakes
5. Create a game in one, join it in the other
6. Play a round of Rock Paper Scissors
7. Check that the winner gets paid and the 5% fee is deducted

---

## 🎯 Summary of URLs

| Service | URL |
|---------|-----|
| Backend API | `https://gowager-backend.onrender.com` |
| Web App | `https://gowager-webapp.vercel.app` |
| Telegram Mini App | `https://gowager-telegram.vercel.app` |
| Database | Neon.tech (connection string in Render env vars) |

---

## 🆘 Troubleshooting

### "Backend not responding"
- Render free tier sleeps after 15 min. Wait 30 seconds and refresh.
- Check Render logs: Render dashboard → your service → **Logs**

### "CORS error"
- Make sure you updated the CORS settings in `backend/server.js`
- Make sure you pushed the changes to GitHub

### "Database connection failed"
- Check your `DATABASE_URL` in Render environment variables
- Make sure it's the full connection string from Neon.tech

### "Telegram app not opening"
- Make sure the Web App URL in BotFather is correct
- Make sure the URL is HTTPS (Vercel provides this automatically)

### "Game not starting"
- Both players must deposit first (each deposits their full stake: rounds × amount per round)
- The second player must press "Start Game"
- Check that both players are connected to the same room code

### "Insufficient balance"
- New accounts start with 0 GHS
- During local testing, credit your wallet with the demo endpoint:
  `POST /api/demo/credit` with body `{ "userId": "...", "amount": 100 }`
- In production, players must fund their wallets through a payment gateway

---

## 💰 Free Tier Limits

| Service | Free Limit |
|---------|-----------|
| Vercel | 100GB bandwidth/month, unlimited static sites |
| Render | 750 hours/month (one service), 512MB RAM |
| Neon.tech | 0.5GB storage, 190 compute hours/month |
| GitHub | Unlimited public repos, 500MB storage |

These limits are more than enough for a small group of friends playing GoWager.

---

## 🔒 Security Notes

- Never commit your `.env` file or database credentials to GitHub
- The `.env.example` file is safe to commit (it has no real values)
- Use strong, unique passwords for all your accounts
- The 5% fee is automatically calculated server-side - users cannot manipulate it
- Remove the `/api/demo/credit` endpoint before going to production

---

## 🎉 Congratulations!

You've successfully deployed GoWager for free! Your friends can now:
1. Open the Telegram bot
2. Play **free** games with friends (no money involved)
3. Play **paid** games with real stakes
4. Win real money (well, real GHS!)

If you have any issues, check the [learnings.md](learnings.md) file for common problems and solutions.