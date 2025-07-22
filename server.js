require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = 8080; // or another available port

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: "secret", resave: false, saveUninitialized: true }));

app.set("views", path.join(__dirname, "views"));
app.engine("html", require("ejs").renderFile);
app.set("view engine", "html");

// const redirectUri = `https://subs.najjjb.xyz/callback`;
const redirectUri = `http://localhost:8080/callback`;

app.get("/", (req, res) => {
  res.render("index", { user: req.session.user });
});

app.get("/login", (req, res) => {
  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;
  res.redirect(discordAuthUrl);
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/");

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        scope: "identify"
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error("Failed to get access token:", tokenData);
      return res.redirect("/");
    }

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const user = await userRes.json();

    // Discord's new username system - discriminator is "0" for new usernames
    const displayName = user.discriminator && user.discriminator !== "0" 
      ? `${user.username}#${user.discriminator}` 
      : user.username;

    await db.addUser(user.id, displayName);
    req.session.user = { id: user.id, name: displayName };
    res.redirect("/dashboard");

  } catch (err) {
    console.error("OAuth Error:", err);
    res.redirect("/");
  }
});

app.get("/dashboard", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const subscriptions = await db.getSubscriptions(req.session.user.id);
  const webhookUrl = await db.getUserWebhook(req.session.user.id);
  res.render("dashboard", { user: req.session.user, subscriptions, webhookUrl });
});

app.post("/add", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const { name, price, renewsAt, notifyDays } = req.body;
  
  // Add subscription to database
  await db.addSubscription(req.session.user.id, name, price, renewsAt, notifyDays);
  
  // Send new subscription notification
  await sendNewSubscriptionNotification(req.session.user.id, {
    name,
    price,
    renewsAt,
    notifyDays
  });
  
  res.redirect("/dashboard");
});

app.post("/remove", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const { name } = req.body;
  await db.removeSubscription(req.session.user.id, name);
  res.redirect("/dashboard");
});

app.post("/webhook", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const { webhookUrl } = req.body;
  await db.updateUserWebhook(req.session.user.id, webhookUrl);
  res.redirect("/dashboard");
});

// Function to send Discord webhook notification
async function sendDiscordNotification(webhookUrl, subscription, type = 'renewal') {
  try {
    let embed;
    
    if (type === 'new') {
      embed = {
        title: "✅ New Subscription Added",
        description: `You've successfully added **${subscription.name}** to your subscription tracker!`,
        color: 0x10B981, // Green color for success
        fields: [
          {
            name: "💰 Price",
            value: `$${subscription.price}/month`,
            inline: true
          },
          {
            name: "📅 Renewal Date",
            value: new Date(subscription.renewsAt).toLocaleDateString(),
            inline: true
          },
          {
            name: "⏰ Notification",
            value: `${subscription.notifyDays} day${subscription.notifyDays > 1 ? 's' : ''} before`,
            inline: true
          }
        ],
        footer: {
          text: "This was an automatic notification from https://subs.najjjb.xyz",
        },
        timestamp: new Date().toISOString()
      };
    } else {
      embed = {
        title: "🔔 Subscription Renewal Reminder",
        description: `Your **${subscription.name}** subscription is renewing soon!`,
        color: 0x5865F2, // Discord blurple
        fields: [
          {
            name: "💰 Price",
            value: `$${subscription.price}/month`,
            inline: true
          },
          {
            name: "📅 Renewal Date",
            value: new Date(subscription.renewsAt).toLocaleDateString(),
            inline: true
          },
          {
            name: "⏰ Notification",
            value: `${subscription.notifyDays} day${subscription.notifyDays > 1 ? 's' : ''} before`,
            inline: true
          }
        ],
        footer: {
          text: "Subscription Tracker"
        },
        timestamp: new Date().toISOString()
      };
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: "Subscription Tracker",
        embeds: [embed]
      })
    });

    if (!response.ok) {
      console.error("Failed to send Discord notification:", response.statusText);
    }
  } catch (error) {
    console.error("Error sending Discord notification:", error);
  }
}

// Function to send new subscription notification (easy to disable)
async function sendNewSubscriptionNotification(userId, subscriptionData) {
  // FEATURE FLAG: Set to false to disable new subscription notifications
  const ENABLE_NEW_SUB_NOTIFICATIONS = true;
  
  if (!ENABLE_NEW_SUB_NOTIFICATIONS) return;
  
  try {
    const webhookUrl = await db.getUserWebhook(userId);
    if (webhookUrl) {
      await sendDiscordNotification(webhookUrl, subscriptionData, 'new');
    }
  } catch (error) {
    console.error("Error sending new subscription notification:", error);
  }
}

// Check for notifications daily (can set up cron job)
async function checkNotifications() {
  try {
    const dueNotifications = await db.getSubscriptionsDueForNotification();
    
    for (const subscription of dueNotifications) {
      if (subscription.webhookUrl) {
        await sendDiscordNotification(subscription.webhookUrl, subscription, 'renewal');
      }
    }
  } catch (error) {
    console.error("Error checking notifications:", error);
  }
}

// Run notification check every hour
setInterval(checkNotifications, 60 * 60 * 1000);

// Manual notification check endpoint (for testing)
app.post("/check-notifications", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  await checkNotifications();
  res.json({ message: "Notifications checked" });
});

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
    }
    res.redirect("/");
  });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));