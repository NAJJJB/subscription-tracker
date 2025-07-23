require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
const db = require("./db");
const crypto = require("crypto");

const app = express();
const PORT = 8080; // or another available port

// Admin security configuration
const ADMIN_USER_ID = process.env.ADMIN_DISCORD_ID; // Your Discord user ID
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || crypto.randomBytes(32).toString('hex');
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Store admin sessions securely
const adminSessions = new Map();

console.log("🔐 Admin Secret Key:", ADMIN_SECRET_KEY);
console.log("🔑 Admin Session Secret:", ADMIN_SESSION_SECRET);

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Add JSON parsing for admin routes
app.use(session({ secret: "secret", resave: false, saveUninitialized: true }));

app.set("views", path.join(__dirname, "views"));
app.engine("html", require("ejs").renderFile);
app.set("view engine", "html");

const redirectUri = `https://subs.najjjb.xyz/callback`;
// const redirectUri = `http://localhost:8080/callback`;

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

// Admin login page
app.get("/admin/login", (req, res) => {
  res.render("admin-login");
});

app.post("/add", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const { name, price, renewsAt, notifyDays, renewalFrequency } = req.body;
  
  // Add subscription to database
  await db.addSubscription(req.session.user.id, name, price, renewsAt, notifyDays, renewalFrequency);
  
  // Send new subscription notification
  await sendNewSubscriptionNotification(req.session.user.id, {
    name,
    price,
    renewsAt,
    notifyDays,
    renewalFrequency
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
            value: `$${subscription.price}/${subscription.renewalFrequency || 'month'}`,
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
            value: `$${subscription.price}/${subscription.renewalFrequency || 'month'}`,
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

// Function to send urgent notifications to all users (ADMIN ONLY)
async function sendUrgentNotificationToAll(title, message) {
  try {
    const allWebhooks = await db.getAllWebhooks();
    let sentCount = 0;
    let failedCount = 0;
    
    for (const webhook of allWebhooks) {
      try {
        const embed = {
          title: title,
          description: message,
          color: 0xDC2626, // Red color for urgent
          footer: {
            text: "🚨 URGENT ADMIN NOTIFICATION - subs.najjjb.xyz"
          },
          timestamp: new Date().toISOString()
        };

        const response = await fetch(webhook.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            username: "🚨 URGENT - Subscription Tracker Admin",
            embeds: [embed]
          })
        });

        if (response.ok) {
          sentCount++;
        } else {
          failedCount++;
          console.error(`Failed to send to webhook ${webhook.id}:`, response.statusText);
        }
      } catch (error) {
        failedCount++;
        console.error(`Error sending to webhook ${webhook.id}:`, error);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`📊 Urgent notification results: ${sentCount} sent, ${failedCount} failed`);
    return { sentCount, failedCount };
  } catch (error) {
    console.error("Error in sendUrgentNotificationToAll:", error);
    throw error;
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

// ==================== ADMIN SECURITY LAYER ====================

// Middleware to verify admin access
function verifyAdmin(req, res, next) {
  // Check if user is authenticated as admin
  if (!req.session.adminAuth || !adminSessions.has(req.session.adminAuth)) {
    return res.status(403).json({ error: "Unauthorized access" });
  }
  
  const session = adminSessions.get(req.session.adminAuth);
  
  // Check session expiry (1 hour)
  if (Date.now() - session.timestamp > 3600000) {
    adminSessions.delete(req.session.adminAuth);
    delete req.session.adminAuth;
    return res.status(403).json({ error: "Session expired" });
  }
  
  // Verify user ID matches admin
  if (session.userId !== ADMIN_USER_ID) {
    return res.status(403).json({ error: "Invalid admin user" });
  }
  
  next();
}

// Admin login endpoint - requires Discord OAuth + secret key
app.post("/admin/login", (req, res) => {
  const { secretKey } = req.body;
  
  // Check if user is logged in via Discord OAuth first
  if (!req.session.user || req.session.user.id !== ADMIN_USER_ID) {
    return res.status(403).json({ error: "Must be logged in as admin user via Discord" });
  }
  
  // Verify secret key
  if (secretKey !== ADMIN_SECRET_KEY) {
    console.log(`🚨 UNAUTHORIZED ADMIN ACCESS ATTEMPT from user ${req.session.user.id}`);
    return res.status(403).json({ error: "Invalid secret key" });
  }
  
  // Create secure admin session
  const sessionId = crypto.randomBytes(32).toString('hex');
  adminSessions.set(sessionId, {
    userId: req.session.user.id,
    timestamp: Date.now(),
    ip: req.ip
  });
  
  req.session.adminAuth = sessionId;
  
  console.log(`✅ Admin authenticated: ${req.session.user.name}`);
  res.json({ success: true, message: "Admin authenticated" });
});

// Admin dashboard
app.get("/admin", verifyAdmin, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>🔐 Admin Console - Subscription Tracker</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: #1a1a1a; color: #fff; }
        .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
        .header { background: #dc2626; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; text-align: center; }
        .form-group { margin-bottom: 1rem; }
        label { display: block; margin-bottom: 0.5rem; color: #f3f4f6; }
        textarea { width: 100%; padding: 1rem; border: 1px solid #374151; border-radius: 8px; background: #111827; color: #fff; font-family: inherit; resize: vertical; min-height: 100px; }
        button { background: #dc2626; color: white; border: none; padding: 1rem 2rem; border-radius: 8px; cursor: pointer; font-size: 1rem; }
        button:hover { background: #b91c1c; }
        .stats { background: #374151; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; }
        .warning { background: #fbbf24; color: #000; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔐 ADMIN CONSOLE</h1>
          <p>Logged in as: ${req.session.user.name}</p>
        </div>
        
        <div class="warning">
          ⚠️ WARNING: This will send notifications to ALL users with webhooks configured!
        </div>
        
        <div class="stats" id="stats">
          Loading statistics...
        </div>
        
        <form id="urgentForm">
          <div class="form-group">
            <label for="title">Notification Title:</label>
            <input type="text" id="title" name="title" style="width: 100%; padding: 0.5rem; border: 1px solid #374151; border-radius: 4px; background: #111827; color: #fff;" placeholder="🚨 Urgent System Notice" required>
          </div>
          
          <div class="form-group">
            <label for="message">Message:</label>
            <textarea id="message" name="message" placeholder="Enter your urgent message here..." required></textarea>
          </div>
          
          <button type="submit">🚨 SEND URGENT NOTIFICATION TO ALL USERS</button>
        </form>
        
        <div id="result"></div>
      </div>
      
      <script>
        // Load statistics
        fetch('/admin/stats')
          .then(r => r.json())
          .then(data => {
            document.getElementById('stats').innerHTML = \`
              <h3>📊 System Statistics</h3>
              <p><strong>Total Users:</strong> \${data.totalUsers}</p>
              <p><strong>Users with Webhooks:</strong> \${data.usersWithWebhooks}</p>
              <p><strong>Total Subscriptions:</strong> \${data.totalSubscriptions}</p>
            \`;
          });
        
        // Handle form submission
        document.getElementById('urgentForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const confirmed = confirm('⚠️ ARE YOU SURE? This will send notifications to ALL users with webhooks!');
          if (!confirmed) return;
          
          const formData = new FormData(e.target);
          const data = Object.fromEntries(formData);
          
          try {
            const response = await fetch('/admin/urgent-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (result.success) {
              document.getElementById('result').innerHTML = \`
                <div style="background: #10b981; padding: 1rem; border-radius: 8px; margin-top: 1rem;">
                  ✅ Successfully sent \${result.sentCount} notifications!
                </div>
              \`;
            } else {
              document.getElementById('result').innerHTML = \`
                <div style="background: #dc2626; padding: 1rem; border-radius: 8px; margin-top: 1rem;">
                  ❌ Error: \${result.error}
                </div>
              \`;
            }
            
            // Clear form
            e.target.reset();
          } catch (error) {
            document.getElementById('result').innerHTML = \`
              <div style="background: #dc2626; padding: 1rem; border-radius: 8px; margin-top: 1rem;">
                ❌ Network error: \${error.message}
              </div>
            \`;
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Get admin statistics
app.get("/admin/stats", verifyAdmin, async (req, res) => {
  try {
    const stats = await db.getAdminStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: "Failed to get statistics" });
  }
});

// Send urgent notification to all users
app.post("/admin/urgent-notification", verifyAdmin, async (req, res) => {
  try {
    const { title, message } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ error: "Title and message are required" });
    }
    
    console.log(`🚨 ADMIN URGENT NOTIFICATION by ${req.session.user.name}: ${title}`);
    
    const result = await sendUrgentNotificationToAll(title, message);
    
    res.json({
      success: true,
      sentCount: result.sentCount,
      failedCount: result.failedCount
    });
  } catch (error) {
    console.error("Error sending urgent notification:", error);
    res.status(500).json({ error: "Failed to send notifications" });
  }
});

// Admin logout
app.post("/admin/logout", verifyAdmin, (req, res) => {
  if (req.session.adminAuth) {
    adminSessions.delete(req.session.adminAuth);
    delete req.session.adminAuth;
  }
  res.json({ success: true });
});