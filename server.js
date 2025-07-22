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

    await db.addUser(user.id, `${user.username}#${user.discriminator}`);
    req.session.user = { id: user.id, name: `${user.username}#${user.discriminator}` };
    res.redirect("/dashboard");

  } catch (err) {
    console.error("OAuth Error:", err);
    res.redirect("/");
  }
});

app.get("/dashboard", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const subscriptions = await db.getSubscriptions(req.session.user.id);
  res.render("dashboard", { user: req.session.user, subscriptions });
});

app.post("/add", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const { name, price } = req.body;
  await db.addSubscription(req.session.user.id, name, price);
  res.redirect("/dashboard");
});

app.post("/remove", async (req, res) => {
  if (!req.session.user) return res.redirect("/");
  const { name } = req.body;
  await db.removeSubscription(req.session.user.id, name);
  res.redirect("/dashboard");
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